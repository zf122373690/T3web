import {useEffect, useMemo, useState} from 'react';
import {Cpu, DownloadCloud, Plus, Power, Radio, RefreshCw, RotateCcw, Save, Send, Settings2, Signal, TerminalSquare, Trash2, X} from 'lucide-react';
import {
  addDevice,
  bulkDeleteDevices,
  batchCheckDeviceOta,
  batchStartDeviceOta,
  checkDeviceFirmwareVersion,
  checkDeviceOta,
  deleteDevice,
  factoryResetDevice,
  getDeviceTakeover,
  listDevices,
  rebootManagedDevice,
  refreshDevice,
  sendDeviceAt,
  sendDeviceSms,
  setDeviceFlymode,
  startDeviceOta,
  updateDeviceConfig,
  updateDeviceSimNumber,
  updateDeviceWifi,
  type DeviceItem,
  type FirmwareOtaResult,
  type T3Config,
  type T3Takeover,
} from '../api/devices';

const channelTypes = ['关闭', 'Webhook/POST', 'Telegram', 'Bark', '钉钉', 'PushDeer', '飞书', '企微机器人', '企微应用', 'Gotify', 'ServerChan', 'PushPlus', 'WxPusher', 'Pushover', 'Inotify', 'Next SMTP Proxy'];

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

function uptimeLabel(value?: number) {
  if (!value) return '-';
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分 ${value % 60} 秒`;
  return `${Math.floor(value / 3600)} 时 ${Math.floor((value % 3600) / 60)} 分`;
}

function defaultConfig(config?: T3Config): T3Config {
  return {
    deviceName: config?.deviceName || '',
    callRecordEnabled: Boolean(config?.callRecordEnabled),
    callRecordAutoAnswer: Boolean(config?.callRecordAutoAnswer),
    callHangupSeconds: config?.callHangupSeconds || 10,
    callPlayEnabled: Boolean(config?.callPlayEnabled),
    callPlayFile: config?.callPlayFile || '',
    recordUploadType: config?.recordUploadType || 0,
    recordUploadUrl: config?.recordUploadUrl || '',
    recordUploadKey1: config?.recordUploadKey1 || '',
    recordUploadKey2: config?.recordUploadKey2 || '',
    cloudEnabled: Boolean(config?.cloudEnabled),
    cloudReportEnabled: config?.cloudReportEnabled !== false,
    cloudUrl: config?.cloudUrl || '',
    cloudToken: config?.cloudToken || '',
    localUrl: config?.localUrl || '',
    localToken: config?.localToken || '',
    networkMode: config?.networkMode || 0,
    webUser: config?.webUser || '',
    webPass: config?.webPass || '',
    sim1Remark: config?.sim1Remark || '',
    sim2Remark: config?.sim2Remark || '',
    sim1Pin: config?.sim1Pin || '',
    sim2Pin: config?.sim2Pin || '',
    sim1PinSet: config?.sim1PinSet || false,
    sim2PinSet: config?.sim2PinSet || false,
    pushChannels: Array.from({length: 5}, (_, index) => ({
      enabled: Boolean(config?.pushChannels?.[index]?.enabled),
      type: config?.pushChannels?.[index]?.type || 0,
      name: config?.pushChannels?.[index]?.name || `Channel ${index + 1}`,
      url: config?.pushChannels?.[index]?.url || '',
      key1: config?.pushChannels?.[index]?.key1 || '',
      key2: config?.pushChannels?.[index]?.key2 || '',
      customBody: config?.pushChannels?.[index]?.customBody || '',
    })),
  };
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
  const [otaResults, setOtaResults] = useState<Record<number, FirmwareOtaResult>>({});
  const [smsDevice, setSmsDevice] = useState<DeviceItem | null>(null);
  const [takeoverDevice, setTakeoverDevice] = useState<DeviceItem | null>(null);
  const [takeover, setTakeover] = useState<T3Takeover | null>(null);
  const [config, setConfig] = useState<T3Config>(defaultConfig());
  const [activeChannel, setActiveChannel] = useState(0);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [atCommand, setAtCommand] = useState('AT');
  const [atResponse, setAtResponse] = useState('');
  const [configReady, setConfigReady] = useState(false);
  const [otaUrl, setOtaUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [content, setContent] = useState('');
  const [simSlot, setSimSlot] = useState(1);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const versionSummary = useMemo(() => items.reduce((acc, item) => {
    const version = item.version || otaResults[item.id]?.data && String((otaResults[item.id].data as {version?: string}).version || '') || '-';
    if (!acc[version]) acc[version] = 0;
    acc[version] += 1;
    return acc;
  }, {} as Record<string, number>), [items, otaResults]);
  const activeChannelData = config.pushChannels?.[activeChannel] || {};

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listDevices();
      setItems(data.items);
      setSelectedIds((current) => current.filter((id) => data.items.some((item) => item.id === id)));
      setTakeoverDevice((current) => current ? data.items.find((item) => item.id === current.id) || current : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const toggleOne = (id: number) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

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
    await runAction(device, async () => {
      const updated = await refreshDevice(device.id);
      setItems((current) => current.map((item) => (item.id === device.id ? updated : item)));
      setTakeoverDevice((current) => current?.id === device.id ? updated : current);
      return {message: '设备信息已刷新'};
    }, '刷新失败');
  };

  const remove = async (device: DeviceItem) => {
    if (!confirm(`删除设备 ${device.name || device.ip}？`)) return;
    setBusyId(device.id);
    setError('');
    try {
      await deleteDevice(device.id);
      setItems((current) => current.filter((item) => item.id !== device.id));
      setSelectedIds((current) => current.filter((id) => id !== device.id));
      setTakeoverDevice((current) => current?.id === device.id ? null : current);
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
      setTakeoverDevice((current) => current && selectedSet.has(current.id) ? null : current);
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
    await runAction(smsDevice, async () => {
      const result = await sendDeviceSms(smsDevice.id, {phone: phone.trim(), content: content.trim(), simSlot});
      setSmsDevice(null);
      setPhone('');
      setContent('');
      return result;
    }, '短信发送失败');
  };

  const selectDevice = async (device: DeviceItem) => {
    setTakeoverDevice(device);
    setTakeover(null);
    setError('');
    setNotice('');
    setAtResponse('');
    setConfigReady(false);
    setWifiSsid(device.wifi.name || '');
    try {
      const data = await getDeviceTakeover(device.id);
      setTakeover(data);
      setConfig(defaultConfig(data.config));
      setConfigReady(Boolean(data.configReady));
      setWifiSsid(data.status.wifi?.ssid || device.wifi.name || '');
    } catch (err) {
      setTakeover({success: false, status: {}, config: {}, configReady: false, configError: err instanceof Error ? err.message : '接管信息读取失败'});
      setConfig(defaultConfig());
      setConfigReady(false);
    }
  };

  const patchConfig = (patch: T3Config) => setConfig((current) => ({...current, ...patch}));
  const patchChannel = (patch: NonNullable<T3Config['pushChannels']>[number]) => setConfig((current) => ({
    ...current,
    pushChannels: (current.pushChannels || []).map((item, index) => index === activeChannel ? {...item, ...patch, enabled: patch.type !== undefined ? patch.type !== 0 : item.enabled} : item),
  }));

  const saveConfig = async () => {
    if (!takeoverDevice || !configReady) return;
    await runAction(takeoverDevice, async () => updateDeviceConfig(takeoverDevice.id, config), '配置保存失败');
    await selectDevice(takeoverDevice);
  };

  const saveWifi = async () => {
    if (!takeoverDevice || !wifiSsid.trim()) return;
    await runAction(takeoverDevice, async () => updateDeviceWifi(takeoverDevice.id, {ssid: wifiSsid.trim(), password: wifiPassword}), 'WiFi 配置失败');
  };

  const saveSimNumber = async (slot: number, number: string) => {
    if (!takeoverDevice) return;
    await runAction(takeoverDevice, async () => updateDeviceSimNumber(takeoverDevice.id, {slot, number}), 'SIM 号码写入失败');
  };

  const runAt = async () => {
    if (!takeoverDevice || !atCommand.trim()) return;
    await runAction(takeoverDevice, async () => {
      const result = await sendDeviceAt(takeoverDevice.id, {command: atCommand.trim(), timeout: 3000});
      setAtResponse(result.data?.response || result.message || 'OK');
      return result;
    }, 'AT 命令执行失败');
  };

  const checkOta = async () => {
    if (!takeoverDevice) return;
    await runAction(takeoverDevice, async () => {
      const result = await checkDeviceOta(takeoverDevice.id);
      if (result.data?.url) setOtaUrl(result.data.url);
      return {message: result.data?.update ? `发现新版本 ${result.data.version || ''}` : '当前已是最新固件'};
    }, 'OTA 检查失败');
  };

  const checkFirmwareVersion = async (device: DeviceItem) => {
    await runAction(device, async () => {
      const result = await checkDeviceFirmwareVersion(device.id);
      const version = String((result.data as {version?: string} | undefined)?.version || device.version || '-');
      setOtaResults((current) => ({...current, [device.id]: {id: device.id, ip: device.ip, success: true, message: `版本 ${version}`, data: {version}, endpoint: result.endpoint}}));
      return {message: `当前版本 ${version}`};
    }, '版本检测失败');
  };

  const checkSelectedFirmware = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await batchCheckDeviceOta(selectedIds);
      const next = {...otaResults};
      result.items.forEach((item) => { next[item.id] = item; });
      setOtaResults(next);
      const firstUrl = result.items.map((item) => String((item.data as {url?: string} | undefined)?.url || '').trim()).find(Boolean);
      if (firstUrl) setOtaUrl(firstUrl);
      setNotice(`已完成 ${result.total} 台设备版本检测`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量版本检测失败');
    } finally {
      setBulkBusy(false);
    }
  };

  const startOta = async () => {
    if (!takeoverDevice || !otaUrl.trim()) return;
    await runAction(takeoverDevice, async () => startDeviceOta(takeoverDevice.id, otaUrl.trim()), 'OTA 升级失败');
  };

  const startSelectedOta = async () => {
    if (selectedIds.length === 0) return;
    setBulkBusy(true);
    setError('');
    setNotice('');
    try {
      let upgradeUrl = selectedIds.map((id) => String((otaResults[id]?.data as {url?: string} | undefined)?.url || '').trim()).find(Boolean) || otaUrl.trim();
      if (!upgradeUrl && takeoverDevice) {
        const checked = await checkDeviceOta(takeoverDevice.id);
        upgradeUrl = String(checked.data?.url || '').trim();
        if (upgradeUrl) setOtaUrl(upgradeUrl);
      }
      if (!upgradeUrl) {
        setError('请先检查任一设备或手动填写 OTA 地址');
        return;
      }
      const result = await batchStartDeviceOta(selectedIds, upgradeUrl);
      const next = {...otaResults};
      result.items.forEach((item) => { next[item.id] = item; });
      setOtaResults(next);
      setNotice(`批量升级已提交 ${result.total} 台设备`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量升级失败');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <section className="page device-takeover-page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">LAN Takeover Mode</span>
          <h1>局域网模式</h1>
          <p>设备需要提前连好 WiFi，并且与当前电脑处在同一局域网。左侧选择设备，右侧直接显示固件接管、配置、AT、OTA 与系统操作。</p>
        </div>
        <button className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={16} /> 刷新</button>
      </div>

      <div className="mode-context-note lan-note">
        <strong>局域网模式提示</strong>
        <span>请先确保设备已经通过 WiFi 接入当前局域网。未联网的新设备请先切换到串口模式，通过 USB 写入 WiFi 与基础配置。</span>
      </div>

      <div className="toolbar actions-bar">
        <input value={ip} onChange={(event) => setIp(event.target.value)} placeholder="手动添加 IP，例如 192.168.1.88" />
        <button className="primary-action" onClick={add} disabled={loading || !ip.trim()}><Plus size={16} /> 添加</button>
        <button className="secondary-button" onClick={() => void checkSelectedFirmware()} disabled={bulkBusy || selectedIds.length === 0}><DownloadCloud size={16} /> 版本检测</button>
        <button className="primary-action" onClick={() => void startSelectedOta()} disabled={bulkBusy || selectedIds.length === 0}><Save size={16} /> 批量升级</button>
        <button className="secondary-button danger-button" onClick={removeSelected} disabled={bulkBusy || selectedIds.length === 0}><Trash2 size={16} /> 删除选中{selectedIds.length ? ` (${selectedIds.length})` : ''}</button>
        <span className="toolbar-tip">已选 {selectedIds.length} 台 · {Object.keys(versionSummary).length} 个版本</span>
      </div>
      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      <div className="lan-console-layout">
        <aside className="lan-device-list">
          <div className="panel-title compact"><div><h2>设备列表</h2><p>点击设备后右侧显示全部控制功能。</p></div></div>
          <div className="lan-device-scroll">
            {items.length === 0 ? <div className="empty device-empty">暂无设备，请先扫描或手动添加。</div> : items.map((device) => (
              <button key={device.id} className={takeoverDevice?.id === device.id ? 'lan-device-card active' : 'lan-device-card'} onClick={() => void selectDevice(device)}>
                <input type="checkbox" checked={selectedSet.has(device.id)} onChange={(event) => { event.stopPropagation(); toggleOne(device.id); }} aria-label={`选择 ${device.name || device.ip}`} />
                <span className="device-card-main"><strong>{device.name || device.ip}</strong><small>{device.group || 'T3 固件设备'}</small></span>
                <span className="device-card-meta"><code>{device.ip}</code><small>版本 {device.version || (otaResults[device.id]?.data as {version?: string} | undefined)?.version || '未知'}</small></span>
              </button>
            ))}
          </div>
        </aside>

        <main className="lan-control-panel">
          {!takeoverDevice ? (
            <div className="takeover-empty-state">
              <Settings2 size={34} />
              <h2>选择一台设备开始接管</h2>
              <p>左侧点击设备后，这里会直接展开 T3 固件的全部控制能力，不再使用弹窗。</p>
            </div>
          ) : (
            <>
              <div className="inline-takeover-header">
                <div>
                  <span className="eyebrow">Selected Device</span>
                  <h2>{takeoverDevice.name || takeoverDevice.ip}</h2>
                  <p>{takeoverDevice.ip} · {takeoverDevice.mac || '未知 MAC'} · 最后在线 {timeLabel(takeoverDevice.lastSeen)}</p>
                </div>
                <div className="inline-header-actions">
                  <button className="secondary-button" onClick={() => refresh(takeoverDevice)} disabled={busyId === takeoverDevice.id}><RefreshCw size={15} /> 刷新设备</button>
                  <button className="secondary-button danger-button" onClick={() => remove(takeoverDevice)} disabled={busyId === takeoverDevice.id}><Trash2 size={15} /> 删除</button>
                </div>
              </div>

              <div className="takeover-metrics">
                <div><span>运行</span><strong>{uptimeLabel(takeover?.status.uptime)}</strong></div>
                <div><span>堆内存</span><strong>{takeover?.status.freeHeap || '-'} B</strong></div>
                <div><span>WiFi</span><strong>{takeover?.status.wifi?.ssid || takeoverDevice.wifi.name || '-'}</strong></div>
                <div><span>信号</span><strong>{String(takeover?.status.modem?.signal_dbm || takeoverDevice.sim1.signal || '-')} dBm</strong></div>
              </div>

              {takeover?.statusError && <div className="error inline-error">{takeover.statusError}</div>}
              {!configReady && <div className="error inline-error">{takeover?.configError || '设备当前配置未读取成功，已禁用保存固件配置，避免空白配置覆盖设备。AT、OTA、重启等操作仍可尝试使用。'}</div>}

              <div className="takeover-grid">
                <section className="takeover-card accent-blue"><h3><Cpu size={17} /> 设备身份</h3><label>设备名称<input value={config.deviceName || ''} onChange={(event) => patchConfig({deviceName: event.target.value})} /></label><label>Web 用户<input value={config.webUser || ''} onChange={(event) => patchConfig({webUser: event.target.value})} /></label><label>Web 密码<input type="password" value={config.webPass || ''} onChange={(event) => patchConfig({webPass: event.target.value})} /></label></section>
                <section className="takeover-card accent-green"><h3><Radio size={17} /> WiFi 热点接管</h3><label>热点名称<input value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} placeholder="路由器 SSID" /></label><label>热点密码<input type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} /></label><button className="secondary-button" onClick={saveWifi} disabled={!wifiSsid.trim() || busyId === takeoverDevice.id}>保存 WiFi 并重连</button></section>
                <section className="takeover-card accent-amber"><h3><Signal size={17} /> SIM 与网络</h3><label>SIM1 号码<input value={String(takeover?.status.modem?.sim1_number || takeoverDevice.sim1.number || '')} onChange={() => undefined} onBlur={(event) => saveSimNumber(1, event.currentTarget.value)} /></label><label>SIM1 PIN 码<input type="password" value={config.sim1Pin || ''} onChange={(event) => patchConfig({sim1Pin: event.target.value})} placeholder={config.sim1PinSet ? '已设置，留空不修改' : '未设置'} /></label><label>SIM2 号码<input value={String(takeover?.status.modem?.sim2_number || takeoverDevice.sim2.number || '')} onChange={() => undefined} onBlur={(event) => saveSimNumber(2, event.currentTarget.value)} /></label><label>SIM2 PIN 码<input type="password" value={config.sim2Pin || ''} onChange={(event) => patchConfig({sim2Pin: event.target.value})} placeholder={config.sim2PinSet ? '已设置，留空不修改' : '未设置'} /></label><label>网络模式<select value={config.networkMode || 0} onChange={(event) => patchConfig({networkMode: Number(event.target.value)})}><option value={0}>自动</option><option value={1}>WiFi only</option><option value={2}>4G only</option></select></label></section>
                <section className="takeover-card"><h3><Settings2 size={17} /> 通话/录音</h3><label>来电处理<select value={config.callRecordEnabled ? (config.callRecordAutoAnswer ? 1 : 2) : 0} onChange={(event) => patchConfig({callRecordEnabled: event.target.value !== '0', callRecordAutoAnswer: event.target.value === '1'})}><option value={0}>关闭</option><option value={1}>自动接听录音</option><option value={2}>仅记录</option></select></label><label>挂断秒数<input type="number" value={config.callHangupSeconds || 10} onChange={(event) => patchConfig({callHangupSeconds: Number(event.target.value)})} /></label><label>TTS 内容<input value={config.callPlayFile || ''} onChange={(event) => patchConfig({callPlayFile: event.target.value})} /></label></section>
                <section className="takeover-card wide"><h3><Send size={17} /> 转发通道</h3><div className="channel-tabs">{[0, 1, 2, 3, 4].map((item) => <button key={item} className={activeChannel === item ? 'active' : ''} onClick={() => setActiveChannel(item)}>通道 {item + 1}</button>)}</div><div className="takeover-two"><label>名称<input value={activeChannelData.name || ''} onChange={(event) => patchChannel({name: event.target.value})} /></label><label>类型<select value={activeChannelData.type || 0} onChange={(event) => patchChannel({type: Number(event.target.value)})}>{channelTypes.map((name, index) => <option key={name} value={index}>{name}</option>)}</select></label></div><label>URL<textarea value={activeChannelData.url || ''} onChange={(event) => patchChannel({url: event.target.value})} /></label><div className="takeover-two"><label>参数1<input value={activeChannelData.key1 || ''} onChange={(event) => patchChannel({key1: event.target.value})} /></label><label>参数2<input value={activeChannelData.key2 || ''} onChange={(event) => patchChannel({key2: event.target.value})} /></label></div><label>模板<textarea value={activeChannelData.customBody || ''} onChange={(event) => patchChannel({customBody: event.target.value})} /></label></section>
                <section className="takeover-card wide"><h3><DownloadCloud size={17} /> 云端 / 本地上报</h3><div className="takeover-two"><label>云端控制<select value={config.cloudEnabled ? 1 : 0} onChange={(event) => patchConfig({cloudEnabled: event.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label><label>状态上报<select value={config.cloudReportEnabled === false ? 0 : 1} onChange={(event) => patchConfig({cloudReportEnabled: event.target.value === '1'})}><option value={1}>开启</option><option value={0}>关闭</option></select></label></div><label>云端地址<textarea value={config.cloudUrl || ''} onChange={(event) => patchConfig({cloudUrl: event.target.value})} /></label><label>云端 Token<input type="password" value={config.cloudToken || ''} onChange={(event) => patchConfig({cloudToken: event.target.value})} /></label><label>本地上报地址<textarea value={config.localUrl || ''} onChange={(event) => patchConfig({localUrl: event.target.value})} /></label></section>
                <section className="takeover-card wide"><h3><TerminalSquare size={17} /> AT / OTA / 系统</h3><div className="serial-command refined"><input value={atCommand} onChange={(event) => setAtCommand(event.target.value)} /><button className="secondary-button" onClick={runAt}>执行 AT</button></div>{atResponse && <pre className="at-response">{atResponse}</pre>}<div className="serial-command refined"><input value={otaUrl} onChange={(event) => setOtaUrl(event.target.value)} placeholder="OTA 固件 URL" /><button className="secondary-button" onClick={checkOta}>检查 OTA</button><button className="secondary-button" onClick={() => takeoverDevice && startDeviceOta(takeoverDevice.id, otaUrl)} disabled={!otaUrl.trim()}>升级</button></div><div className="modal-actions"><button className="secondary-button danger-button" onClick={() => confirm('确认恢复出厂？') && runAction(takeoverDevice, () => factoryResetDevice(takeoverDevice.id), '恢复出厂失败')}><RotateCcw size={16} /> 恢复出厂</button><button className="secondary-button danger-button" onClick={() => runAction(takeoverDevice, () => rebootManagedDevice(takeoverDevice.id), '重启失败')}><Power size={16} /> 重启</button><button className="primary-action" onClick={saveConfig} disabled={!configReady}><Save size={16} /> 保存固件配置</button></div></section>
              </div>
            </>
          )}
        </main>
      </div>

      {smsDevice && (
        <div className="modal-backdrop" onClick={() => setSmsDevice(null)}><div className="modal-panel" onClick={(event) => event.stopPropagation()}><div className="modal-header"><h2>发送短信</h2><button onClick={() => setSmsDevice(null)}><X size={18} /></button></div><div className="form-grid"><label>目标号码<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="手机号" autoFocus /></label><label>SIM 卡槽<select value={simSlot} onChange={(event) => setSimSlot(Number(event.target.value))}><option value={1}>SIM 1</option><option value={2}>SIM 2</option></select></label><label className="full-field">短信内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} placeholder="输入要发送的短信内容" /></label></div><div className="modal-actions"><button className="secondary-button" onClick={() => setSmsDevice(null)}>取消</button><button className="primary-action" onClick={sendSms} disabled={busyId === smsDevice.id || !phone.trim() || !content.trim()}><Send size={16} /> 发送</button></div></div></div>
      )}
    </section>
  );
}
