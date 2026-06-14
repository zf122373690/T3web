import {useEffect, useMemo, useRef, useState} from 'react';
import {CheckCircle2, Loader2, Plus, Radar, Router, Save, XCircle} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {addDevice, getScanStatus, saveScanResults, startScan, type ScanStatus} from '@/api/devices';

export default function LanDevices() {
  const [cidr, setCidr] = useState('');
  const [user, setUser] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [manualIp, setManualIp] = useState('');
  const [manualMac, setManualMac] = useState('');
  const [scanId, setScanId] = useState('');
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const pollRef = useRef<number | null>(null);

  const progress = useMemo(() => {
    if (!scanStatus?.total) return 0;
    return Math.round(((scanStatus.total - scanStatus.pending) / scanStatus.total) * 100);
  }, [scanStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const stopPolling = () => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const pollScan = (id: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const status = await getScanStatus(id);
        setScanStatus(status);
        if (status.pending <= 0) {
          stopPolling();
          setScanning(false);
          toast.success(`扫描完成，发现 ${status.found} 台目标设备`);
        }
      } catch (error) {
        console.error(error);
        stopPolling();
        setScanning(false);
        toast.error('扫描状态获取失败');
      }
    }, 1000);
  };

  const handleStartScan = async () => {
    setScanning(true);
    setScanStatus(null);
    try {
      const result = await startScan({cidr: cidr.trim() || undefined, user, password});
      setScanId(result.scanId);
      setScanStatus({
        id: result.scanId,
        cidr: result.cidr,
        total: result.total,
        found: 0,
        failed: 0,
        pending: result.total,
        elapsed: 0,
        results: [],
      });
      pollScan(result.scanId);
    } catch (error) {
      console.error(error);
      setScanning(false);
      toast.error('启动扫描失败');
    }
  };

  const handleSaveResults = async () => {
    if (!scanId) return;
    setSaving(true);
    try {
      const result = await saveScanResults(scanId, {user, password});
      toast.success(`已保存 ${result.saved} 台设备`);
    } catch (error) {
      console.error(error);
      toast.error('保存扫描结果失败');
    } finally {
      setSaving(false);
    }
  };

  const handleAddManual = async () => {
    const ip = manualIp.trim();
    if (!ip) {
      toast.error('请输入设备 IP');
      return;
    }
    setSaving(true);
    try {
      await addDevice({ip, mac: manualMac.trim(), user, password});
      setManualIp('');
      setManualMac('');
      toast.success('设备已添加');
    } catch (error) {
      console.error(error);
      toast.error('添加设备失败');
    } finally {
      setSaving(false);
    }
  };

  const successfulResults = scanStatus?.results.filter((item) => item.success) ?? [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">局域网扫描</h1>
        <p className="mt-1 text-sm text-gray-500">扫描同网段内运行短信转发固件的设备，并保存到设备管理。</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Radar className="size-5 text-blue-600"/>
              扫描参数
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">CIDR 网段</span>
                <Input placeholder="自动识别或 192.168.1.0/24" value={cidr} onChange={(event) => setCidr(event.target.value)}/>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">用户名</span>
                <Input value={user} onChange={(event) => setUser(event.target.value)}/>
              </label>
              <label className="space-y-1.5">
                <span className="text-sm font-medium text-gray-700">密码</span>
                <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)}/>
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleStartScan} disabled={scanning}>
                {scanning ? <Loader2 className="animate-spin"/> : <Radar/>}
                {scanning ? '扫描中' : '开始扫描'}
              </Button>
              <Button variant="outline" onClick={handleSaveResults} disabled={!scanId || scanning || saving || successfulResults.length === 0}>
                {saving ? <Loader2 className="animate-spin"/> : <Save/>}
                保存发现设备
              </Button>
            </div>

            {scanStatus && (
              <div className="space-y-3 rounded-lg border bg-gray-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-700">{scanStatus.cidr}</span>
                  <span className="text-gray-500">{progress}% · 剩余 {scanStatus.pending} / {scanStatus.total}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                  <div className="h-full rounded-full bg-blue-600 transition-all" style={{width: `${progress}%`}}/>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-md bg-white p-3">
                    <div className="text-xl font-semibold text-gray-900">{scanStatus.total}</div>
                    <div className="text-gray-500">扫描地址</div>
                  </div>
                  <div className="rounded-md bg-white p-3">
                    <div className="text-xl font-semibold text-green-700">{scanStatus.found}</div>
                    <div className="text-gray-500">发现设备</div>
                  </div>
                  <div className="rounded-md bg-white p-3">
                    <div className="text-xl font-semibold text-gray-700">{scanStatus.failed}</div>
                    <div className="text-gray-500">未匹配</div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="size-5 text-blue-600"/>
              手动添加
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="设备 IP，例如 192.168.1.88" value={manualIp} onChange={(event) => setManualIp(event.target.value)}/>
            <Input placeholder="MAC，可选" value={manualMac} onChange={(event) => setManualMac(event.target.value)}/>
            <Button className="w-full" variant="outline" onClick={handleAddManual} disabled={saving}>
              {saving ? <Loader2 className="animate-spin"/> : <Plus/>}
              添加设备
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Router className="size-5 text-blue-600"/>
            扫描结果
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!scanStatus ? (
            <div className="py-10 text-center text-sm text-gray-500">尚未开始扫描。</div>
          ) : scanStatus.results.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-500">等待扫描结果返回。</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b text-xs uppercase text-gray-400">
                  <tr>
                    <th className="py-3 pr-4">IP</th>
                    <th className="py-3 pr-4">状态</th>
                    <th className="py-3 pr-4">设备信息</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {scanStatus.results.map((item) => (
                    <tr key={item.ip}>
                      <td className="py-3 pr-4 font-mono text-gray-800">{item.ip}</td>
                      <td className="py-3 pr-4">
                        {item.success ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                            <CheckCircle2 className="size-3.5"/> 已发现
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                            <XCircle className="size-3.5"/> 未匹配
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-gray-600">
                        {item.success ? JSON.stringify(item.data ?? {}) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
