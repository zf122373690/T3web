import {useEffect, useMemo, useState} from 'react';
import {RefreshCw, Settings2, Send, FileText, Power, MapPin, Monitor, Trash2, Plus, Radar, Search, DownloadCloud, Save} from 'lucide-react';
import {
  addDevice,
  bulkDeleteDevices,
  batchCheckDeviceOta,
  batchStartDeviceOta,
  checkDeviceFirmwareVersion,
  checkDeviceOta,
  clearDeviceMessages,
  deleteDevice,
  factoryResetDevice,
  getDeviceTakeover,
  listDevices,
  rebootManagedDevice,
  refreshAllDevices,
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
  type T3MqttConfig,
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

function normalizedMqtt(config?: T3Config): T3MqttConfig {
  const mqtt = config?.mqtt || {};
  return {
    enabled: config?.mqttEnabled ?? mqtt.enabled ?? false,
    broker: config?.mqttServer || mqtt.broker || mqtt.server || mqtt.host || '',
    port: config?.mqttPort || mqtt.port || 1883,
    topicPrefix: config?.mqttTopic || mqtt.topicPrefix || mqtt.topic || 't3/events',
    username: config?.mqttUser || mqtt.username || mqtt.user || '',
    password: config?.mqttPass || mqtt.password || mqtt.pass || '',
    clientId: config?.mqttClientId || mqtt.clientId || '',
    keepAlive: mqtt.keepAlive || 60,
    statusInterval: mqtt.statusInterval || 60,
  };
}

function defaultConfig(config?: T3Config): T3Config {
  const mqtt = normalizedMqtt(config);
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
    mqttEnabled: Boolean(mqtt.enabled),
    mqttServer: mqtt.broker || '',
    mqttPort: mqtt.port || 1883,
    mqttTopic: mqtt.topicPrefix || 't3/events',
    mqttUser: mqtt.username || '',
    mqttPass: mqtt.password || '',
    mqttClientId: mqtt.clientId || '',
    mqtt,
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

function configPayload(config: T3Config): T3Config {
  const mqtt = {
    ...(config.mqtt || {}),
    enabled: Boolean(config.mqttEnabled),
    broker: config.mqttServer || '',
    port: config.mqttPort || 1883,
    topicPrefix: config.mqttTopic || 't3/events',
    username: config.mqttUser || '',
    password: config.mqttPass || '',
    clientId: config.mqttClientId || '',
  };
  return {...config, mqtt};
}

export default function Devices() {
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [networkPrefix, setNetworkPrefix] = useState('192.168.123.');
  const [startIp, setStartIp] = useState('1');
  const [endIp, setEndIp] = useState('254');
  const [devicePassword, setDevicePassword] = useState('');

  // Statistics
  const stats = useMemo(() => {
    const total = items.length;
    const online = items.filter(i => i.status === 'online').length;
    const simSlots = total * 2;
    const sim1Active = items.filter(i => i.sim1?.present || i.sim1?.number).length;
    const sim2Active = items.filter(i => i.sim2?.present || i.sim2?.number).length;
    const noSim = items.filter(i => !(i.sim1?.present || i.sim1?.number) && !(i.sim2?.present || i.sim2?.number)).length;
    const withSim = sim1Active + sim2Active;
    const registered = items.filter(i => i.sim1?.registered || i.sim2?.registered).length;
    return {total, online, simSlots, noSim, withSim, registered};
  }, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => 
      item.name.toLowerCase().includes(q) ||
      item.ip.includes(q) ||
      item.sim1?.number.toLowerCase().includes(q) ||
      item.sim2?.number.toLowerCase().includes(q) ||
      item.group.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listDevices();
      setItems(data.items);
      setTakeoverDevice((current) => current ? data.items.find((item) => item.id === current.id) || current : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const data = await refreshAllDevices();
      setItems(data.items);
      setTakeoverDevice((current) => current ? data.items.find((item) => item.id === current.id) || current : current);
      setNotice(`已刷新 ${data.items.length} 台设备`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
    const ip = `${networkPrefix}${startIp}`;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await addDevice({ip, password: devicePassword});
      await load();
      setNotice(`设备 ${ip} 已添加`);
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
      setTakeoverDevice((current) => current?.id === device.id ? null : current);
      setNotice('设备已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  };

  const clearAll = () => {
    if (!confirm('确认清空所有设备？')) return;
    setItems([]);
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

  const openTakeover = async (device: DeviceItem) => {
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
    await runAction(takeoverDevice, async () => updateDeviceConfig(takeoverDevice.id, configPayload(config)), '配置保存失败');
    await openTakeover(takeoverDevice);
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

  const startOta = async () => {
    if (!takeoverDevice || !otaUrl.trim()) return;
    await runAction(takeoverDevice, async () => startDeviceOta(takeoverDevice.id, otaUrl.trim()), 'OTA 升级失败');
  };

  return (
    <section className="page devices-page">
      {/* Statistics Bar */}
      <div className="stats-bar">
        <span className="stat-item"> 设备 {stats.total}</span>
        <span className="stat-item stat-online"> {stats.online}</span>
        <span className="stat-item">卡槽 {stats.simSlots}</span>
        <span className="stat-item stat-nosim">❌ 无卡 {stats.noSim}</span>
        <span className="stat-item stat-sim">🟡 插卡 {stats.withSim}</span>
        <span className="stat-item stat-registered">✅ 已注册 {stats.registered}</span>
      </div>

      {/* Scan Control Panel */}
      <div className="scan-control-panel">
        <div className="scan-inputs">
          <label>
            <span>网段前缀</span>
            <input value={networkPrefix} onChange={(e) => setNetworkPrefix(e.target.value)} placeholder="192.168.123." />
          </label>
          <label>
            <span>起始IP</span>
            <input value={startIp} onChange={(e) => setStartIp(e.target.value)} placeholder="1" />
          </label>
          <label>
            <span>结束IP</span>
            <input value={endIp} onChange={(e) => setEndIp(e.target.value)} placeholder="254" />
          </label>
          <label>
            <span>设备密码</span>
            <input type="password" value={devicePassword} onChange={(e) => setDevicePassword(e.target.value)} placeholder="后台密码" />
          </label>
        </div>
        <div className="scan-actions">
          <button className="btn-primary" onClick={() => {}} disabled={loading}>🔍 开始扫描</button>
          <button className="btn-secondary" onClick={refreshAll} disabled={loading}>🔄 刷新全部</button>
          <button className="btn-secondary" onClick={add} disabled={loading}>➕ 添加设备</button>
          <button className="btn-secondary" onClick={clearAll} disabled={loading}>🗑️ 清空列表</button>
          <button className="btn-secondary" onClick={() => {}} disabled={loading}>⚙️ 统一设置</button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="search-bar">
        <Search size={16} className="search-icon" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索编号/号码/IP/备注..."
        />
      </div>

      {/* Error/Notice */}
      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      {/* Data Table */}
      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>设备编号</th>
              <th>IP地址</th>
              <th>状态</th>
              <th>版本号</th>
              <th>SIM卡1</th>
              <th>SIM卡2</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">暂无设备，请先扫描或手动添加。</td>
              </tr>
            ) : filteredItems.map((device) => (
              <tr key={device.id}>
                <td>
                  <strong>{device.name || device.ip}</strong>
                  <br />
                  <small className="text-muted">{device.group}</small>
                </td>
                <td><code>{device.ip}</code></td>
                <td>
                  <span className={`status-badge ${device.status === 'online' ? 'status-online' : 'status-offline'}`}>
                    {device.status === 'online' ? '🟢 在线' : '⚫ 离线'}
                  </span>
                </td>
                <td>{device.version || String(otaResults[device.id]?.data?.version ?? '-')}</td>
                <td>
                  {(device.sim1?.present || device.sim1?.number) ? (
                    <div>
                      <div>{device.sim1.number || '未设置号码'}</div>
                      <small className="text-muted">
                        {device.sim1.operator}
                        {device.sim1.registered ? ' · ✅已注册' : ' · ❌未注册'}
                      </small>
                    </div>
                  ) : (
                    <span className="text-muted">❌ 无卡</span>
                  )}
                </td>
                <td>
                  {(device.sim2?.present || device.sim2?.number) ? (
                    <div>
                      <div>{device.sim2.number || '未设置号码'}</div>
                      <small className="text-muted">
                        {device.sim2.operator}
                        {device.sim2.registered ? ' · ✅已注册' : ' · ❌未注册'}
                      </small>
                    </div>
                  ) : (
                    <span className="text-muted">❌ 无卡</span>
                  )}
                </td>
                <td className="action-buttons">
                  <button className="btn-action" onClick={() => refresh(device)} disabled={busyId === device.id}>🔄 刷新</button>
                  <button className="btn-action" onClick={() => openTakeover(device)}>⚙️ 配置</button>
                  <button className="btn-action" onClick={() => setSmsDevice(device)}>💬 短信</button>
                  <button className="btn-action" onClick={() => {}}>📋 记录</button>
                  <button className="btn-action" onClick={() => runAction(device, () => rebootManagedDevice(device.id), '重启失败')} disabled={busyId === device.id}>⚡ 重启</button>
                  <button className="btn-action" onClick={() => window.open(`http://${device.ip}`, '_blank')}>🖥️ 后台</button>
                  <button className="btn-action btn-danger" onClick={() => remove(device)} disabled={busyId === device.id}>🗑️ 删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SMS Modal */}
      {smsDevice && (
        <div className="modal-backdrop" onClick={() => setSmsDevice(null)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>发送短信</h2>
              <button onClick={() => setSmsDevice(null)}>✕</button>
            </div>
            <div className="form-grid">
              <label>目标号码<input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号" autoFocus /></label>
              <label>SIM 卡槽<select value={simSlot} onChange={(e) => setSimSlot(Number(e.target.value))}><option value={1}>SIM 1</option><option value={2}>SIM 2</option></select></label>
              <label className="full-field">短信内容<textarea value={content} onChange={(e) => setContent(e.target.value)} rows={5} placeholder="输入要发送的短信内容" /></label>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setSmsDevice(null)}>取消</button>
              <button className="btn-primary" onClick={sendSms} disabled={busyId === smsDevice.id || !phone.trim() || !content.trim()}>💬 发送</button>
            </div>
          </div>
        </div>
      )}

      {/* Takeover Modal (Config Panel) */}
      {takeoverDevice && (
        <div className="modal-backdrop" onClick={() => setTakeoverDevice(null)}>
          <div className="modal-panel modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{takeoverDevice.name || takeoverDevice.ip}</h2>
              <button onClick={() => setTakeoverDevice(null)}>✕</button>
            </div>
            <div className="takeover-content">
              <div className="takeover-metrics">
                <div><span>运行</span><strong>{uptimeLabel(takeover?.status.uptime)}</strong></div>
                <div><span>堆内存</span><strong>{takeover?.status.freeHeap || '-'} B</strong></div>
                <div><span>WiFi</span><strong>{takeover?.status.wifi?.ssid || takeoverDevice.wifi.name || '-'}</strong></div>
                <div><span>信号</span><strong>{String(takeover?.status.modem?.signal_dbm || takeoverDevice.sim1.signal || '-')} dBm</strong></div>
              </div>

              {takeover?.statusError && <div className="error inline-error">{takeover.statusError}</div>}
              {!configReady && <div className="error inline-error">{takeover?.configError || '设备当前配置未读取成功，已禁用保存固件配置。AT、OTA、重启等操作仍可尝试使用。'}</div>}

              <div className="save-config-bar">
                <button className="btn-primary" onClick={saveConfig} disabled={!configReady}>💾 保存固件配置</button>
              </div>

              <div className="takeover-grid">
                <section className="takeover-card accent-blue">
                  <h3>📱 设备身份</h3>
                  <label>设备名称<input value={config.deviceName || ''} onChange={(e) => patchConfig({deviceName: e.target.value})} /></label>
                  <label>Web 用户<input value={config.webUser || ''} onChange={(e) => patchConfig({webUser: e.target.value})} /></label>
                  <label>Web 密码<input type="password" value={config.webPass || ''} onChange={(e) => patchConfig({webPass: e.target.value})} /></label>
                </section>

                <section className="takeover-card accent-green">
                  <h3>📶 WiFi 热点接管</h3>
                  <label>热点名称<input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} placeholder="路由器 SSID" /></label>
                  <label>热点密码<input type="password" value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="留空不修改" /></label>
                  <button className="btn-secondary" onClick={saveWifi} disabled={!wifiSsid.trim() || busyId === takeoverDevice.id}>保存 WiFi 并重连</button>
                </section>

                <section className="takeover-card accent-amber">
                  <h3> SIM 与网络</h3>
                  <label>SIM1 号码<input value={String(takeover?.status.modem?.sim1_number || takeoverDevice.sim1.number || '')} onChange={() => undefined} onBlur={(e) => saveSimNumber(1, e.currentTarget.value)} /></label>
                  <label>SIM1 PIN 码<input type="password" value={config.sim1Pin || ''} onChange={(e) => patchConfig({sim1Pin: e.target.value})} placeholder={config.sim1PinSet ? '已设置，留空不修改' : '未设置'} /></label>
                  <label>SIM2 号码<input value={String(takeover?.status.modem?.sim2_number || takeoverDevice.sim2.number || '')} onChange={() => undefined} onBlur={(e) => saveSimNumber(2, e.currentTarget.value)} /></label>
                  <label>SIM2 PIN 码<input type="password" value={config.sim2Pin || ''} onChange={(e) => patchConfig({sim2Pin: e.target.value})} placeholder={config.sim2PinSet ? '已设置，留空不修改' : '未设置'} /></label>
                  <label>网络模式<select value={config.networkMode || 0} onChange={(e) => patchConfig({networkMode: Number(e.target.value)})}><option value={0}>自动</option><option value={1}>WiFi only</option><option value={2}>4G only</option></select></label>
                </section>

                <section className="takeover-card">
                  <h3>📞 通话/录音</h3>
                  <label>来电处理<select value={config.callRecordEnabled ? (config.callRecordAutoAnswer ? 1 : 2) : 0} onChange={(e) => patchConfig({callRecordEnabled: e.target.value !== '0', callRecordAutoAnswer: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>自动接听录音</option><option value={2}>仅记录</option></select></label>
                  <label>挂断秒数<input type="number" value={config.callHangupSeconds || 10} onChange={(e) => patchConfig({callHangupSeconds: Number(e.target.value)})} /></label>
                  <label>TTS 内容<input value={config.callPlayFile || ''} onChange={(e) => patchConfig({callPlayFile: e.target.value})} /></label>
                </section>

                <section className="takeover-card wide">
                  <h3>📤 转发通道</h3>
                  <div className="channel-tabs">
                    {[0, 1, 2, 3, 4].map((i) => <button key={i} className={activeChannel === i ? 'active' : ''} onClick={() => setActiveChannel(i)}>通道 {i + 1}</button>)}
                  </div>
                  <div className="takeover-two">
                    <label>名称<input value={config.pushChannels?.[activeChannel]?.name || ''} onChange={(e) => patchChannel({name: e.target.value})} /></label>
                    <label>类型<select value={config.pushChannels?.[activeChannel]?.type || 0} onChange={(e) => patchChannel({type: Number(e.target.value)})}>{channelTypes.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
                  </div>
                  <label>URL<textarea value={config.pushChannels?.[activeChannel]?.url || ''} onChange={(e) => patchChannel({url: e.target.value})} /></label>
                  <div className="takeover-two">
                    <label>参数1<input value={config.pushChannels?.[activeChannel]?.key1 || ''} onChange={(e) => patchChannel({key1: e.target.value})} /></label>
                    <label>参数2<input value={config.pushChannels?.[activeChannel]?.key2 || ''} onChange={(e) => patchChannel({key2: e.target.value})} /></label>
                  </div>
                  <label>模板<textarea value={config.pushChannels?.[activeChannel]?.customBody || ''} onChange={(e) => patchChannel({customBody: e.target.value})} /></label>
                </section>

                <section className="takeover-card wide">
                  <h3>📊 MQTT 上报</h3>
                  <div className="takeover-two">
                    <label>MQTT 开关<select value={config.mqttEnabled ? 1 : 0} onChange={(e) => patchConfig({mqttEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>Broker 地址<input value={config.mqttServer || ''} onChange={(e) => patchConfig({mqttServer: e.target.value})} placeholder="mqtt.example.com" /></label>
                  </div>
                  <div className="takeover-two">
                    <label>端口<input type="number" value={config.mqttPort || 1883} onChange={(e) => patchConfig({mqttPort: Number(e.target.value)})} /></label>
                    <label>主题前缀<input value={config.mqttTopic || ''} onChange={(e) => patchConfig({mqttTopic: e.target.value})} placeholder="sms" /></label>
                  </div>
                  <div className="takeover-two">
                    <label>用户名<input value={config.mqttUser || ''} onChange={(e) => patchConfig({mqttUser: e.target.value})} /></label>
                    <label>密码<input type="password" value={config.mqttPass || ''} onChange={(e) => patchConfig({mqttPass: e.target.value})} /></label>
                  </div>
                  <div className="takeover-two">
                    <label>心跳(秒)<input type="number" value={config.mqtt?.keepAlive || 60} onChange={(e) => patchConfig({mqtt: {...config.mqtt, keepAlive: Number(e.target.value)}})} /></label>
                    <label>状态间隔(秒)<input type="number" value={config.mqtt?.statusInterval || 60} onChange={(e) => patchConfig({mqtt: {...config.mqtt, statusInterval: Number(e.target.value)}})} /></label>
                  </div>
                  <label>Client ID<input value={config.mqttClientId || ''} onChange={(e) => patchConfig({mqttClientId: e.target.value})} placeholder="留空自动生成" /></label>
                </section>

                <section className="takeover-card wide">
                  <h3>⚙️ AT / OTA / 系统</h3>
                  <div className="serial-command refined">
                    <input value={atCommand} onChange={(e) => setAtCommand(e.target.value)} />
                    <button className="btn-secondary" onClick={runAt}>执行 AT</button>
                  </div>
                  {atResponse && <pre className="at-response">{atResponse}</pre>}
                  <div className="serial-command refined">
                    <input value={otaUrl} onChange={(e) => setOtaUrl(e.target.value)} placeholder="OTA 固件 URL" />
                    <button className="btn-secondary" onClick={checkOta}>检查 OTA</button>
                    <button className="btn-secondary" onClick={() => takeoverDevice && startDeviceOta(takeoverDevice.id, otaUrl)} disabled={!otaUrl.trim()}>升级</button>
                  </div>
                  <div className="modal-actions">
                    <button className="btn-secondary btn-danger" onClick={() => confirm('确认恢复出厂？') && runAction(takeoverDevice, () => factoryResetDevice(takeoverDevice.id), '恢复出厂失败')}>🔄 恢复出厂</button>
                    <button className="btn-secondary btn-danger" onClick={() => confirm('清空设备 messages.log 消息日志？') && runAction(takeoverDevice, () => clearDeviceMessages(takeoverDevice.id), '清空设备日志失败')}>🗑️ 清空设备日志</button>
                    <button className="btn-secondary btn-danger" onClick={() => runAction(takeoverDevice, () => rebootManagedDevice(takeoverDevice.id), '重启失败')}>⚡ 重启</button>
                  </div>
                </section>
              </div>
              <div className="save-config-bar">
                <button className="btn-primary" onClick={saveConfig} disabled={!configReady}>💾 保存固件配置</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
