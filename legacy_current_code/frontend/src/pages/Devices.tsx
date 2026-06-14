import {useEffect, useMemo, useState} from 'react';
import {RefreshCw, Router, Search, Trash2} from 'lucide-react';
import {toast} from 'sonner';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {deleteDevice, listDevices, refreshDevice, type ManagedDevice} from '@/api/devices';

function displayName(device: ManagedDevice) {
  return device.alias?.trim() || device.devId || device.ip;
}

function formatTime(value?: number) {
  if (!value) return '-';
  return new Date(value * 1000).toLocaleString('zh-CN');
}

export default function Devices() {
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const filteredDevices = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return devices;
    return devices.filter((device) =>
      [device.alias, device.devId, device.ip, device.mac, device.grp]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(text)),
    );
  }, [devices, query]);

  const loadDevices = async () => {
    setLoading(true);
    try {
      setDevices(await listDevices());
    } catch (error) {
      console.error(error);
      toast.error('设备列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDevices();
  }, []);

  const handleRefreshOne = async (device: ManagedDevice) => {
    setBusyId(device.id);
    try {
      const updated = await refreshDevice(device.id);
      setDevices((current) => current.map((item) => (item.id === device.id ? updated : item)));
      toast.success('设备状态已刷新');
    } catch (error) {
      console.error(error);
      toast.error('刷新设备失败');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (device: ManagedDevice) => {
    if (!window.confirm(`确认删除设备 ${displayName(device)}？`)) return;
    setBusyId(device.id);
    try {
      await deleteDevice(device.id);
      setDevices((current) => current.filter((item) => item.id !== device.id));
      toast.success('设备已删除');
    } catch (error) {
      console.error(error);
      toast.error('删除设备失败');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">设备管理</h1>
          <p className="mt-1 text-sm text-gray-500">管理局域网扫描保存的短信转发设备。</p>
        </div>
        <Button onClick={loadDevices} disabled={loading} variant="outline">
          <RefreshCw className={loading ? 'animate-spin' : ''}/>
          刷新
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400"/>
        <Input className="pl-9" placeholder="搜索 IP、MAC、设备名或分组" value={query} onChange={(event) => setQuery(event.target.value)}/>
      </div>

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600"/>
        </div>
      ) : filteredDevices.length === 0 ? (
        <Card className="rounded-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Router className="size-10 text-gray-300"/>
            <div className="font-medium text-gray-700">还没有设备</div>
            <div className="text-sm text-gray-500">请先在“局域网扫描”里扫描并保存设备。</div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filteredDevices.map((device) => (
            <Card key={device.id} className="rounded-lg">
              <CardHeader className="gap-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-base">{displayName(device)}</CardTitle>
                    <div className="mt-1 font-mono text-sm text-blue-600">{device.ip}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${device.status === 'online' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {device.status === 'online' ? '在线' : '离线'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-gray-400">MAC</div>
                    <div className="truncate font-mono text-gray-700">{device.mac || '-'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">分组</div>
                    <div className="text-gray-700">{device.grp || 'auto'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">SIM1</div>
                    <div className="truncate text-gray-700">{device.sims?.sim1?.number || device.sims?.sim1?.operator || '-'}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">SIM2</div>
                    <div className="truncate text-gray-700">{device.sims?.sim2?.number || device.sims?.sim2?.operator || '-'}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-xs text-gray-400">最后在线：{formatTime(device.lastSeen)}</div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleRefreshOne(device)} disabled={busyId === device.id}>
                      <RefreshCw className={busyId === device.id ? 'animate-spin' : ''}/>
                      刷新
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(device)} disabled={busyId === device.id}>
                      <Trash2/>
                      删除
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
