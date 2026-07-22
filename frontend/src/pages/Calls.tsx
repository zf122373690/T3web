import {useCallback, useEffect, useRef, useState} from 'react';
import {Download, RefreshCw, Trash2} from 'lucide-react';
import {listCalls, clearCalls, deleteCall, syncDeviceRecords, type CallItem} from '../api/messages';

const PAGE_SIZE = 100;
const AUTO_REFRESH_MS = 10_000;

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

function durationLabel(seconds?: number) {
  if (!seconds || seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export default function Calls() {
  const [items, setItems] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const autoRefreshing = useRef(false);

  const load = useCallback(async (nextPage = 1, append = false, quiet = false) => {
    if (!quiet) setLoading(true);
    setError('');
    try {
      const data = await listCalls({page: nextPage, pageSize: PAGE_SIZE});
      setItems((current) => append ? [...current, ...data.items] : data.items);
      setTotal(data.total);
      setPage(data.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (autoRefreshing.current) return;
      autoRefreshing.current = true;
      try {
        await load(1, false, true);
      } finally {
        autoRefreshing.current = false;
      }
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  const syncRecords = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const result = await syncDeviceRecords();
      setNotice(result.message);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步设备记录失败');
    } finally {
      setSyncing(false);
    }
  };

  const remove = async (call: CallItem) => {
    if (!confirm('删除这条通话记录？')) return;
    await deleteCall(call.id);
    setItems((current) => current.filter((item) => item.id !== call.id));
    setTotal((value) => Math.max(0, value - 1));
  };

  const clearAll = async () => {
    if (!confirm('清空所有通话记录？')) return;
    await clearCalls();
    setItems([]);
    setTotal(0);
    setPage(0);
  };

  return (
    <section className="page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">Call Archive</span>
          <h1>通话记录</h1>
          <p>共 {total} 条来电记录，每 10 秒自动同步刷新。</p>
        </div>
        <div className="messages-hero-actions">
          <button className="primary-action" onClick={syncRecords} disabled={loading || syncing}><Download size={16} /> {syncing ? '同步中...' : '立即同步'}</button>
          <button className="secondary-button compact-action" onClick={() => load()} disabled={loading || syncing}><RefreshCw size={15} /> 刷新</button>
          <button className="secondary-button" onClick={clearAll} disabled={loading || syncing || items.length === 0}><Trash2 size={16} /> 清空</button>
        </div>
      </div>

      {notice && <div className="success inline-error">{notice}</div>}
      {error && <div className="error inline-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>设备名称 / ID</th>
              <th>SIM / 本机号码</th>
              <th>来电号码</th>
              <th>时长</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="empty">暂无通话记录。</td></tr>
            ) : items.map((call) => (
              <tr key={call.id}>
                <td>{timeLabel(call.createdAt)}</td>
                <td><strong>{call.deviceName || '未知设备'}</strong><br /><small className="text-muted">{call.deviceId || '-'}</small></td>
                <td>{call.simSlot || '-'}<br /><small className="text-muted">{call.simNumber || '号码未记录'}</small></td>
                <td><code>{call.phone}</code></td>
                <td>{durationLabel(call.duration)}</td>
                <td className="row-actions">
                  <button title="删除" onClick={() => remove(call)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length < total && (
        <div className="messages-load-more">
          <button className="secondary-button" onClick={() => load(page + 1, true)} disabled={loading || syncing}>
            {loading ? '加载中...' : `加载更多（${items.length}/${total}）`}
          </button>
        </div>
      )}
    </section>
  );
}
