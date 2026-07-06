import {useRef, useState} from 'react';
import {Plus, Radar, Save} from 'lucide-react';
import {addDevice, getScanStatus, startScan, type ScanStatus} from '../api/devices';

export default function Scan() {
  const [cidr, setCidr] = useState('');
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('admin123');
  const [status, setStatus] = useState<ScanStatus | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [claimingIp, setClaimingIp] = useState('');
  const timer = useRef<number | null>(null);

  const stopTimer = () => {
    if (timer.current) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  };

  const scan = async () => {
    stopTimer();
    setRunning(true);
    setError('');
    setStatus(null);
    try {
      const started = await startScan({cidr: cidr.trim() || undefined, user, password});
      setAutoDetected(started.autoDetected);
      setStatus({
        id: started.scanId,
        cidr: started.cidr,
        total: started.total,
        pending: started.total,
        found: 0,
        failed: 0,
        done: false,
        results: [],
      });
      timer.current = window.setInterval(async () => {
        try {
          const next = await getScanStatus(started.scanId);
          setStatus(next);
          if (next.done || next.pending <= 0) {
            setRunning(false);
            stopTimer();
          }
        } catch (err) {
          setRunning(false);
          stopTimer();
          setError(err instanceof Error ? err.message : '扫描状态获取失败');
        }
      }, 1000);
    } catch (err) {
      setRunning(false);
      setError(err instanceof Error ? err.message : '启动扫描失败');
    }
  };

  const progress = status?.total ? Math.round(((status.total - status.pending) / status.total) * 100) : 0;

  const claim = async (ip: string) => {
    setClaimingIp(ip);
    setError('');
    try {
      const device = await addDevice({ip, user, password});
      setStatus((current) => {
        if (!current) return current;
        return {
          ...current,
          results: current.results.map((item) => item.ip === ip ? {...item, success: true, candidate: true, autoSaved: true, device} : item),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '接管失败');
    } finally {
      setClaimingIp('');
    }
  };

  return (
    <section className="page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">Sector Scan</span>
          <h1>星域扫描</h1>
          <p>只识别带 LAN 密钥发现接口的短信转发节点，识别成功后自动加入节点列表。</p>
        </div>
      </div>

      <div className="scan-panel">
        <label>
          <span>CIDR 网段</span>
          <input value={cidr} onChange={(event) => setCidr(event.target.value)} placeholder="留空自动识别，或 192.168.1.0/24" />
        </label>
        <label>
          <span>设备用户名</span>
          <input value={user} onChange={(event) => setUser(event.target.value)} />
        </label>
        <label>
          <span>设备密码</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        <button className="primary-action" onClick={scan} disabled={running}>
          <Radar size={16} /> {running ? '扫描中...' : '开始扫描'}
        </button>
      </div>

      {error && <div className="error inline-error">{error}</div>}

      {status && (
        <div className="scan-status">
          <div className="status-line">
            <strong>{status.cidr}</strong>
            <span>{autoDetected ? '自动识别 · ' : ''}{progress}% · 发现 {status.found} · 剩余 {status.pending}</span>
          </div>
          <div className="progress"><div style={{width: `${progress}%`}} /></div>
        </div>
      )}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>IP</th>
              <th>结果</th>
              <th>状态 / 操作</th>
            </tr>
          </thead>
          <tbody>
            {!status || status.results.length === 0 ? (
              <tr><td colSpan={3} className="empty">暂无扫描结果。</td></tr>
            ) : status.results.map((result) => (
              <tr key={result.ip}>
                <td><code>{result.ip}</code></td>
                <td>{result.success ? '已识别设备' : result.httpOpen ? '未识别或未升级固件' : '未开放 HTTP'}</td>
                <td>
                  {result.device ? (
                    <span className="saved"><Save size={14} /> 已自动加入：{result.device.name}</span>
                  ) : result.candidate ? (
                    <button className="small-action" disabled={claimingIp === result.ip} onClick={() => claim(result.ip)}>
                      <Plus size={14} /> {claimingIp === result.ip ? '接管中...' : '重新接管'}
                    </button>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
