import {useEffect, useMemo, useState} from 'react';
import {Plane, Plus, Power, RefreshCw, Send, Trash2, X} from 'lucide-react';
import {
  addDevice,
  bulkDeleteDevices,
  deleteDevice,
  listDevices,
  rebootManagedDevice,
  refreshDevice,
  sendDeviceSms,
  setDeviceFlymode,
  type DeviceItem,
} from '../api/devices';

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

export default function Devices() {
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [ip, setIp] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [smsDevice, setSmsDevice] = useState<DeviceItem | null>(null);
  const [phone, setPhone] = useState('');
  const [content, setContent] = useState('');
  const [simSlot, setSimSlot] = useState(1);

  const allSelected = items.length > 0 && selectedIds.length === items.length;
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listDevices();
      setItems(data.items);
      setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.id === id)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleAll = () => {
    setSelectedIds(allSelected ? [] : items.map((item) => item.id));
  };

  const toggleOne = (id: number) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  const runAction = async (device: DeviceItem, action: () => Promise<{message?: string}>, fallback: string) => {
    setBusyId(device.id);
    setError('');
    setNotice('');
    try {
      const result = await action();
      setNotice(result.message || fallback);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusyId(null);
    }
  };

  const add = async () => {
    if (!ip.trim()) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await addDevice({ip: ip.trim()});
      setIp('');
      await load();
      setNotice('设备已添加');
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setLoading(false);
    }
  };

  const refresh = async (device: DeviceItem) => {
    await runAction(
      device,
      async () => {
        const updated = await refreshDevice(device.id);
        setItems((current) => current.map((item) => (item.id === device.id ? updated : item)));
        return {message: '设备信息已刷新'};
      },
      '刷新失败',
    );
  };

  const remove = async (device: DeviceItem) => {
    if (!confirm(`删除设备 ${device.name || device.ip}？`)) return;
    setBusyId(device.id);
    setError('');
    try {
      await deleteDevice(device.id);
      setItems((current) => current.filter((item) => item.id !== device.id));
      setSelectedIds((current) => current.filter((id) => id !== device.id));
      setNotice('设备已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const removeSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!confirm(`删除选中的 ${selectedIds.length} 台设备？`)) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await bulkDeleteDevices(selectedIds);
      setItems((current) => current.filter((item) => !selectedSet.has(item.id)));
      setSelectedIds([]);
      setNotice(`已删除 ${result.deleted} 台设备`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量删除失败');
    } finally {
      setBulkBusy(false);
    }
  };

  const sendSms = async () => {
    if (!smsDevice || !phone.trim() || !content.trim()) return;
    await runAction(
      smsDevice,
      async () => {
        const result = await sendDeviceSms(smsDevice.id, {phone: phone.trim(), content: content.trim(), simSlot});
        setSmsDevice(null);
        setPhone('');
        setContent('');
        return result;
      },
      '短信发送失败',
    );
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>设备管理</h1>
          <p>查看、接管并控制局域网内的短信转发设备。</p>
        </div>
        <button className="secondary-button" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      <div className="toolbar">
        <input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="手动添加 IP，例如 192.168.1.88" />
        <button className="primary-action" onClick={add} disabled={loading || !ip.trim()}>
          <Plus size={16} /> 添加
        </button>
        <button className="secondary-button danger-button" onClick={removeSelected} disabled={bulkBusy || selectedIds.length === 0}>
          <Trash2 size={16} /> 删除选中{selectedIds.length ? ` (${selectedIds.length})` : ''}
        </button>
      </div>
      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th className="select-column">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="全选设备" />
              </th>
              <th>设备</th>
              <th>IP / MAC</th>
              <th>SIM</th>
              <th>WiFi</th>
              <th>最后在线</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={7} className="empty">暂无设备，请先扫描或手动添加。</td></tr>
            ) : items.map((device) => (
              <tr key={device.id} className={selectedSet.has(device.id) ? 'selected-row' : ''}>
                <td className="select-column">
                  <input type="checkbox" checked={selectedSet.has(device.id)} onChange={() => toggleOne(device.id)} aria-label={`选择 ${device.name || device.ip}`} />
                </td>
                <td>
                  <strong>{device.name}</strong>
                  <span className="muted">{device.version || device.group}</span>
                </td>
                <td>
                  <code>{device.ip}</code>
                  <span className="muted">{device.mac || '-'}</span>
                </td>
                <td>
                  <span>{device.sim1.number || device.sim1.operator || '-'}</span>
                  <span className="muted">{device.sim2.number || device.sim2.operator || '-'}</span>
                </td>
                <td>
                  <span>{device.wifi.name || '-'}</span>
                  <span className="muted">{device.wifi.dbm ? `${device.wifi.dbm} dBm` : ''}</span>
                </td>
                <td>{timeLabel(device.lastSeen)}</td>
                <td className="row-actions wide-actions">
                  <button title="发送短信" disabled={busyId === device.id} onClick={() => setSmsDevice(device)}><Send size={15} /></button>
                  <button title="开启飞行模式" disabled={busyId === device.id} onClick={() => runAction(device, () => setDeviceFlymode(device.id, true), '飞行模式设置失败')}><Plane size={15} /></button>
                  <button title="关闭飞行模式" disabled={busyId === device.id} onClick={() => runAction(device, () => setDeviceFlymode(device.id, false), '飞行模式设置失败')}><X size={15} /></button>
                  <button title="重启设备" disabled={busyId === device.id} onClick={() => confirm(`重启设备 ${device.name || device.ip}？`) && runAction(device, () => rebootManagedDevice(device.id), '重启失败')}><Power size={15} /></button>
                  <button title="刷新" disabled={busyId === device.id} onClick={() => refresh(device)}><RefreshCw size={15} /></button>
                  <button title="删除" disabled={busyId === device.id} onClick={() => remove(device)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {smsDevice && (
        <div className="modal-backdrop" onClick={() => setSmsDevice(null)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>发送短信</h2>
              <button onClick={() => setSmsDevice(null)}><X size={18} /></button>
            </div>
            <div className="form-grid">
              <label>
                目标号码
                <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="手机号" autoFocus />
              </label>
              <label>
                SIM 卡槽
                <select value={simSlot} onChange={(event) => setSimSlot(Number(event.target.value))}>
                  <option value={1}>SIM 1</option>
                  <option value={2}>SIM 2</option>
                </select>
              </label>
              <label className="full-field">
                短信内容
                <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="输入要发送的短信内容" />
              </label>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setSmsDevice(null)}>取消</button>
              <button className="primary-action" onClick={sendSms} disabled={busyId === smsDevice.id || !phone.trim() || !content.trim()}>
                <Send size={16} /> 发送
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
