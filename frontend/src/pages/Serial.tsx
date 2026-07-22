import {useEffect, useMemo, useRef, useState} from 'react';
import {Activity, Cable, Download, FileDown, FileUp, Plug, RadioReceiver, RefreshCw, Save, Unplug, Wifi} from 'lucide-react';
import {checkSerialVersions, connectSerial, disconnectSerial, getSerialLogs, getSerialStatus, listSerialPorts, probeSerial, readSerialDeviceConfig, resetSerialDevice, saveSerialWifiBatch, sendSerialBatchOfflineConfig, setSerialControlLines, startSerialOta, type SerialBatchActionResult, type SerialDeviceConfig, type SerialLogItem, type SerialOfflineChannel, type SerialPortItem, type SerialStatus} from '../api/serial';
import {getSystemVersion, type SystemVersionInfo} from '../api/devices';
import SelfUpdateBar from '../components/SelfUpdateBar';

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleTimeString('zh-CN', {hour12: false}) : '--:--:--';
}

function logLabel(level: SerialLogItem['level']) {
  const labels = {rx: '接收', tx: '发送', system: '系统', error: '错误'};
  return labels[level] || level;
}

const defaultChannelTemplate = '【{{设备名称}}】{{事件标题}}\n号码: {{号码}}\n内容: {{内容}}\n时间: {{时间}}\n来源: SIM{{卡槽}} {{卡号}}\n备注: {{备注}}';

function defaultChannels() {
  return Array.from({length: 5}, () => ({enabled: false, type: 0, url: '', key1: '', key2: '', customBody: defaultChannelTemplate}));
}

function normalizeChannels(channels?: SerialOfflineChannel[]) {
  const loaded = (channels || []).map((ch) => ({
    enabled: ch.enabled,
    type: ch.type,
    url: ch.url || '',
    key1: ch.key1 || '',
    key2: ch.key2 || '',
    customBody: ch.customBody || defaultChannelTemplate,
  }));
  while (loaded.length < 5) loaded.push({enabled: false, type: 0, url: '', key1: '', key2: '', customBody: defaultChannelTemplate});
  return loaded.slice(0, 5);
}

export default function Serial() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [ports, setPorts] = useState<SerialPortItem[]>([]);
  const [status, setStatus] = useState<SerialStatus | null>(null);
  const [logs, setLogs] = useState<SerialLogItem[]>([]);
  const [activePort, setActivePort] = useState('');
  const [baudrate, setBaudrate] = useState(115200);
  const [safeMode, setSafeMode] = useState(true);
  const [cdcMode, setCdcMode] = useState(true);
  const [dtrEnabled, setDtrEnabled] = useState(false);
  const [rtsEnabled, setRtsEnabled] = useState(false);
  const [streamMode, setStreamMode] = useState<'ws' | 'poll'>('poll');
  const [deviceName, setDeviceName] = useState('');
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [deviceNameTouched, setDeviceNameTouched] = useState(false);
  const [wifiTouched, setWifiTouched] = useState(false);
  const [sim1Pin, setSim1Pin] = useState('');
  const [sim2Pin, setSim2Pin] = useState('');
  const [sim1PinSet, setSim1PinSet] = useState(false);
  const [sim2PinSet, setSim2PinSet] = useState(false);
  const [sim1PinTouched, setSim1PinTouched] = useState(false);
  const [sim2PinTouched, setSim2PinTouched] = useState(false);
  const [channels, setChannels] = useState<SerialOfflineChannel[]>(defaultChannels);
  const [channelsTouched, setChannelsTouched] = useState(false);
  const [selectedPorts, setSelectedPorts] = useState<string[]>([]);
  const [activeChannel, setActiveChannel] = useState(0);
  const [lastConfig, setLastConfig] = useState<SerialDeviceConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [versionInfo, setVersionInfo] = useState<SystemVersionInfo | null>(null);
  const [actionResults, setActionResults] = useState<SerialBatchActionResult | null>(null);
  const [otaUrl, setOtaUrl] = useState('');

  const sessions = status?.sessions || [];
  const currentSession = sessions.find((item) => item.port === activePort);
  const selectedConnected = Boolean(status?.connected && status.port === activePort);
  const activeChannelData = channels[activeChannel] || {};
  const rxCount = useMemo(() => logs.filter((item) => item.level === 'rx').length, [logs]);
  const txCount = useMemo(() => logs.filter((item) => item.level === 'tx').length, [logs]);
  const visibleLogs = useMemo(() => [...logs].reverse().slice(0, 200), [logs]);
  const connectedPorts = useMemo(() => sessions.filter((item) => item.connected).map((item) => item.port), [sessions]);

  const applyConfig = (cfg: SerialDeviceConfig, markTouched = false) => {
    setDeviceName(typeof cfg.deviceName === 'string' ? cfg.deviceName : '');
    setDeviceNameTouched(markTouched && typeof cfg.deviceName === 'string');
    setWifiSsid(typeof cfg.wifi?.ssid === 'string' ? cfg.wifi.ssid : '');
    setWifiPassword(typeof cfg.wifi?.password === 'string' ? cfg.wifi.password : '');
    setShowWifiPassword(false);
    setWifiTouched(false);
    setSim1Pin(markTouched && typeof cfg.sim1Pin === 'string' ? cfg.sim1Pin : '');
    setSim2Pin(markTouched && typeof cfg.sim2Pin === 'string' ? cfg.sim2Pin : '');
    setSim1PinSet(Boolean(cfg.sim1PinSet));
    setSim2PinSet(Boolean(cfg.sim2PinSet));
    setSim1PinTouched(markTouched && Boolean(cfg.sim1Pin));
    setSim2PinTouched(markTouched && Boolean(cfg.sim2Pin));
    setChannels(normalizeChannels(cfg.pushChannels));
    setChannelsTouched(markTouched && Array.isArray(cfg.pushChannels));
    setLastConfig(cfg);
    setConfigLoaded(true);
  };

  const loadPorts = async () => {
    const data = await listSerialPorts();
    setPorts(data.items);
    setActivePort((current) => current || data.items[0]?.name || '');
    if (!data.available) setError('后端未安装 pyserial，请安装依赖后重启服务');
  };

  const loadStatus = async (port = activePort) => {
    const data = await getSerialStatus(port);
    setStatus(data);
    const nextPort = port || data.activePort || data.port || activePort || data.sessions?.[0]?.port || ports[0]?.name || '';
    if (nextPort && nextPort !== activePort) setActivePort(nextPort);
    if (data.port === nextPort && data.connected) {
      setBaudrate(data.baudrate);
      setSafeMode(data.safeMode);
      setCdcMode(data.cdcMode);
      setDtrEnabled(data.dtrEnabled);
      setRtsEnabled(data.rtsEnabled);
    }
  };

  const loadLogs = async (port = activePort) => {
    const data = await getSerialLogs(300, 0, port);
    setLogs(data.items);
  };

  const refreshAll = async (port = activePort) => {
    setLoading(true);
    try {
      await Promise.all([loadPorts(), loadStatus(port), loadLogs(port)]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
    void getSystemVersion().then(setVersionInfo).catch(() => setVersionInfo(null));
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || !activePort) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/api/serial/ws?token=${encodeURIComponent(token)}&port=${encodeURIComponent(activePort)}`);
    ws.onopen = () => setStreamMode('ws');
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {type: string; data: SerialLogItem | SerialStatus};
        if (payload.type === 'log') {
          const item = payload.data as SerialLogItem;
          setLogs((current) => current.some((log) => item.id && log.id === item.id) ? current : [...current, item].slice(-300));
        }
        if (payload.type === 'status') setStatus(payload.data as SerialStatus);
      } catch {
        setStreamMode('poll');
      }
    };
    ws.onerror = () => setStreamMode('poll');
    ws.onclose = () => setStreamMode('poll');
    return () => ws.close();
  }, [activePort]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadStatus(activePort);
      if (streamMode !== 'ws') void loadLogs(activePort);
    }, streamMode === 'ws' ? 5000 : 2000);
    return () => window.clearInterval(timer);
  }, [activePort, streamMode]);

  useEffect(() => {
    setSelectedPorts((current) => {
      const next = current.filter((port) => connectedPorts.includes(port));
      return next.length === current.length ? current : next;
    });
  }, [connectedPorts]);

  const selectPort = async (port: string) => {
    setActivePort(port);
    setConfigLoaded(false);
    setError('');
    setNotice('');
    await Promise.all([loadStatus(port), loadLogs(port)]);
  };

  const connect = async (port = activePort) => {
    if (!port) return;
    setLoading(true);
    setError('');
    setNotice('');
    setConfigLoaded(false);
    try {
      const result = await connectSerial({port, baudrate, safeMode, cdcMode, dtr: dtrEnabled, rts: rtsEnabled});
      setNotice(result.message || '串口已连接');
      setActivePort(port);
      setSelectedPorts((current) => current.includes(port) ? current : [...current, port]);
      await refreshAll(port);
      await loadDeviceConfig(port);
    } catch (err) {
      setError(err instanceof Error ? err.message : '串口连接失败');
    } finally {
      setLoading(false);
    }
  };

  const disconnect = async (port = activePort) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await disconnectSerial(port);
      setNotice(result.message || '串口已断开');
      await refreshAll(port);
    } catch (err) {
      setError(err instanceof Error ? err.message : '串口断开失败');
    } finally {
      setLoading(false);
    }
  };

  const loadDeviceConfig = async (port = activePort) => {
    if (!port) return;
    setError('');
    setNotice('');
    try {
      const result = await readSerialDeviceConfig(port);
      if (result.success && result.config) {
        applyConfig(result.config);
        setNotice(`已读取 ${port} 的配置`);
      } else {
        setConfigLoaded(false);
        setError(result.message || '设备配置读取失败');
      }
    } catch (err) {
      setConfigLoaded(false);
      setError(err instanceof Error ? err.message : '设备配置读取失败');
    }
  };

  const checkFirmwareVersion = async () => {
    const targets = selectedPorts.filter((port) => connectedPorts.includes(port));
    if (!targets.length) {
      setError('请至少选择一个已连接串口');
      return;
    }
    try {
      const result = await checkSerialVersions({ports: targets});
      setActionResults(result);
      setFirmwareVersion(result.items.find((item) => item.success && item.version)?.version || '');
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '串口版本检测失败');
    }
  };

  const saveWifiOnly = async () => {
    const targets = selectedPorts.filter((port) => connectedPorts.includes(port));
    if (!targets.length || !wifiSsid.trim()) {
      setError(targets.length ? 'WiFi 名称不能为空' : '请至少选择一个已连接串口');
      return;
    }
    try {
      const result = await saveSerialWifiBatch({ports: targets, wifiSsid: wifiSsid.trim(), wifiPassword});
      setActionResults(result);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'WiFi 保存失败');
    }
  };

  const upgradeSerialPorts = async () => {
    const targets = selectedPorts.filter((port) => connectedPorts.includes(port));
    if (!targets.length || !otaUrl.trim()) {
      setError(targets.length ? '请输入 OTA 固件 URL' : '请至少选择一个已连接串口');
      return;
    }
    try {
      const result = await startSerialOta({ports: targets, url: otaUrl.trim()});
      setActionResults(result);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : '串口 OTA 触发失败');
    }
  };

  const buildConfigPayload = () => ({
    deviceName: deviceNameTouched ? deviceName.trim() || undefined : undefined,
    wifiSsid: wifiTouched ? wifiSsid.trim() || undefined : undefined,
    wifiPassword: wifiTouched && wifiSsid.trim() ? wifiPassword : undefined,
    pushChannels: channelsTouched ? channels : undefined,
    sim1Pin: sim1PinTouched ? sim1Pin.trim() || undefined : undefined,
    sim2Pin: sim2PinTouched ? sim2Pin.trim() || undefined : undefined,
  });

  const saveSelectedPorts = async () => {
    const targets = selectedPorts.filter((port) => connectedPorts.includes(port));
    if (!targets.length) {
      setError('请至少选择一个已连接串口');
      return;
    }
    if (!wifiSsid.trim()) {
      setError('首次配置必须填写 WiFi 名称；其他配置未修改时会保持设备原值');
      return;
    }
    const payload = buildConfigPayload();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await sendSerialBatchOfflineConfig({ports: targets, ...payload, wifiSsid: wifiSsid.trim(), wifiPassword});
      const failedItems = result.items.filter((item) => !item.success);
      if (failedItems.length) {
        setError(failedItems.map((item) => `${item.port}：${item.message}`).join('；'));
      }
      setNotice(result.message);
      if (!failedItems.length) {
        setDeviceNameTouched(false);
        setWifiTouched(false);
        setSim1PinTouched(false);
        setSim2PinTouched(false);
        setChannelsTouched(false);
      }
      await loadLogs(activePort);
    } catch (err) {
      setError(err instanceof Error ? err.message : '批量配置失败');
    } finally {
      setLoading(false);
    }
  };

  const exportConfig = () => {
    const cfg = lastConfig || {deviceName: deviceName.trim(), pushChannels: channels, sim1Pin: sim1Pin.trim(), sim2Pin: sim2Pin.trim()};
    const blob = new Blob([JSON.stringify(cfg, null, 2)], {type: 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `t3-config-${deviceName || activePort || 'device'}.json`.replace(/[\\/:*?"<>|]/g, '-');
    link.click();
    URL.revokeObjectURL(url);
  };

  const importConfig = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const cfg = JSON.parse(text) as SerialDeviceConfig;
      applyConfig(cfg, true);
      setNotice('配置文件已导入，可选择多个已连接串口批量保存');
    } catch {
      setError('配置文件解析失败');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const patchChannel = (patch: SerialOfflineChannel) => {
    setChannelsTouched(true);
    setChannels((current) => current.map((item, index) => index === activeChannel ? {...item, ...patch, enabled: patch.type !== undefined ? patch.type !== 0 : item.enabled} : item));
  };

  const toggleLines = async (dtr: boolean, rts: boolean) => {
    try {
      const result = await setSerialControlLines({dtr, rts, port: activePort});
      setDtrEnabled(dtr);
      setRtsEnabled(rts);
      setNotice(result.message || '控制线已切换');
      await refreshAll(activePort);
    } catch (err) {
      setError(err instanceof Error ? err.message : '控制线切换失败');
    }
  };

  const runProbe = async () => {
    try {
      const result = await probeSerial(3, activePort);
      setNotice(result.bytesReceived ? `诊断完成，已收到 ${result.bytesReceived} 字节` : '诊断完成，未收到字节');
      await refreshAll(activePort);
    } catch (err) {
      setError(err instanceof Error ? err.message : '串口诊断失败');
    }
  };

  const resetDevice = async () => {
    try {
      const result = await resetSerialDevice(activePort);
      setNotice(result.message || '复位脉冲已发送');
      await loadLogs(activePort);
    } catch (err) {
      setError(err instanceof Error ? err.message : '复位失败');
    }
  };

  const renderPortCard = (item: SerialPortItem) => {
    const session = sessions.find((sessionItem) => sessionItem.port === item.name);
    const connected = Boolean(session?.connected);
    const selected = selectedPorts.includes(item.name);
    return (
      <div key={item.name} className={`multi-port-card ${activePort === item.name ? 'active' : ''} ${connected ? 'connected' : ''} ${selected ? 'selected' : ''}`}>
        <input
          type="checkbox"
          checked={selected}
          disabled={!connected}
          aria-label={`选择 ${item.name} 作为保存目标`}
          onChange={(event) => setSelectedPorts((current) => event.target.checked ? [...current, item.name] : current.filter((port) => port !== item.name))}
        />
        <button type="button" onClick={() => void selectPort(item.name)}>
          <span className="multi-port-dot" />
          <strong>{item.name}</strong>
          <small>{item.description}</small>
          <em>{connected ? `${session?.baudrate || baudrate} · ${session?.logCount || 0} 条` : '未连接'}</em>
        </button>
      </div>
    );
  };

  return (
    <section className="page serial-page compact-serial-page">
      <div className="serial-hero compact-hero">
        <div>
          <span className="eyebrow">Serial Desk</span>
          <h1>串口工作台</h1>
          <p>集中处理多串口连接、设备配置读写、配置复刻、导入导出、诊断、DTR/RTS 控制与底部实时日志。</p>
        </div>
        <div className="serial-hero-actions">
          <button className="secondary-button" onClick={() => void refreshAll(activePort)} disabled={loading}><RefreshCw size={16} />刷新</button>
          <button className="primary-action" onClick={() => void connect(activePort)} disabled={loading || !activePort || selectedConnected}><Plug size={16} />连接当前</button>
        </div>
      </div>

      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}
      <div className="version-banner"><span>T3服务端 {versionInfo?.localVersion || '检测中'}</span><span>OTA 服务器 {versionInfo?.otaServerVersion || versionInfo?.otaServerMessage || '检测中'}</span><span>串口设备 {firmwareVersion || '请选择串口检测'}</span></div>
      {actionResults && <div className="serial-result-list">{actionResults.items.map((item) => <span key={item.port} className={item.success ? 'result-ok' : 'result-fail'}>{item.port}：{item.version ? `${item.version} · ` : ''}{item.message}</span>)}</div>}

      <div className="multi-serial-layout">
        <aside className="serial-panel multi-port-panel">
          <div className="panel-title compact-title"><div><h2><Cable size={17} /> 串口列表</h2><p>{connectedPorts.length} 个已连接 · 已选 {selectedPorts.length} 个</p></div></div>
          <div className="multi-port-list">{ports.length ? ports.map(renderPortCard) : <div className="empty">未发现串口</div>}</div>
          <div className="port-selection-actions">
            <button className="secondary-button" onClick={() => setSelectedPorts(connectedPorts)} disabled={!connectedPorts.length}>全选已连接</button>
            <button className="secondary-button" onClick={() => setSelectedPorts([])} disabled={!selectedPorts.length}>清空</button>
          </div>
          <div className="compact-connect-box">
            <label><span>波特率</span><input type="number" value={baudrate} min={1} onChange={(event) => setBaudrate(Number(event.target.value) || 115200)} disabled={selectedConnected} /></label>
            <label><span>模式</span><select value={cdcMode ? 'cdc' : safeMode ? 'safe' : 'normal'} onChange={(event) => { setCdcMode(event.target.value === 'cdc'); setSafeMode(event.target.value !== 'normal'); }} disabled={selectedConnected}><option value="cdc">稳定连接</option><option value="safe">防复位</option><option value="normal">标准</option></select></label>
            <div className="compact-button-row">
              {selectedConnected ? <button className="secondary-button danger-button" onClick={() => void disconnect(activePort)}><Unplug size={15} />断开</button> : <button className="secondary-button" onClick={() => void connect(activePort)} disabled={!activePort}><Plug size={15} />连接</button>}
              <button className="secondary-button" onClick={() => void loadDeviceConfig(activePort)} disabled={!selectedConnected}><Download size={15} />读取</button>
            <button className="secondary-button" onClick={() => void checkFirmwareVersion()} disabled={!selectedPorts.length}><Save size={15} />检测版本</button>
            </div>
          </div>
        </aside>

        <main className="serial-panel compact-config-panel">
          <div className="panel-title compact-title">
            <div><h2><Wifi size={17} /> 配置编辑</h2><p>{activePort || '请选择串口'} · {configLoaded ? '已读取' : '未读取'}</p></div>
            <div className="compact-actions">
              <button className="secondary-button" onClick={exportConfig}><FileDown size={15} />导出</button>
              <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><FileUp size={15} />导入</button>
              <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importConfig(event.target.files?.[0])} />
            </div>
          </div>

          <div className="serial-main-wizard">
            <div className="wizard-section wifi-wizard-section">
              <div className="wizard-step-number">01</div>
              <div className="wizard-section-title"><span><Wifi size={16} /> 首次配置 WiFi</span><small>必填。设备保存后会尝试连接此 2.4 GHz 热点；请确认名称和密码准确。</small></div>
              <div className="wifi-wizard-fields">
                <label><span>WiFi 名称 *</span><input value={wifiSsid} onChange={(event) => { setWifiSsid(event.target.value); setWifiTouched(true); }} placeholder="输入 2.4 GHz 热点名称" /></label>
                <label><span>WiFi 密码</span><div className="password-input-row"><input type={showWifiPassword ? 'text' : 'password'} value={wifiPassword} onChange={(event) => { setWifiPassword(event.target.value); setWifiTouched(true); }} placeholder="开放热点可留空" /><button type="button" className="secondary-button" onClick={() => setShowWifiPassword((current) => !current)}>{showWifiPassword ? '隐藏' : '查看'}</button></div></label>
              </div>
              <div className="wizard-required-note">WiFi 凭据只会写入选中的已连接串口，支持并行保存并返回逐端口结果。</div>
              <button className="primary-action" onClick={() => void saveWifiOnly()} disabled={loading || !wifiSsid.trim() || !selectedPorts.some((port) => connectedPorts.includes(port))}><Wifi size={16} />保存 WiFi 到已选串口（{selectedPorts.filter((port) => connectedPorts.includes(port)).length}）</button>
            </div>
            <div className="wizard-section optional-wizard-section">
              <div className="wizard-step-number">02</div>
              <div className="wizard-section-title"><span>可选配置</span><small>只有本次修改的内容才会写入，未修改项继续保留设备原配置。</small></div>
              <div className="compact-grid wizard-config-grid">
                <label className="full-field"><span>设备名称</span><input value={deviceName} onChange={(event) => { setDeviceName(event.target.value); setDeviceNameTouched(true); }} placeholder="不修改可保持原值" /></label>
                <label><span>SIM1 PIN</span><input type="password" value={sim1Pin} onChange={(event) => { setSim1Pin(event.target.value); setSim1PinTouched(true); }} placeholder={sim1PinSet ? '已设置，不修改请留空' : '不设置请留空'} /></label>
                <label><span>SIM2 PIN</span><input type="password" value={sim2Pin} onChange={(event) => { setSim2Pin(event.target.value); setSim2PinTouched(true); }} placeholder={sim2PinSet ? '已设置，不修改请留空' : '不设置请留空'} /></label>
              </div>
            </div>
          </div>

          <div className="mini-channel-shell">
            <div className="wizard-section-title"><span>可选转发通道</span><small>通道按固定位置写入；默认模板包含备注字段。</small></div>
            <div className="channel-tabs serial-channel-tabs compact-tabs">{channels.map((_, index) => <button key={index} className={activeChannel === index ? 'active' : ''} onClick={() => setActiveChannel(index)}>通道 {index + 1}</button>)}</div>
            <div className="compact-grid channel-compact-grid">
              <label><span>类型</span><select value={activeChannelData.type || 0} onChange={(event) => patchChannel({type: Number(event.target.value)})}><option value={0}>关闭</option><option value={1}>Webhook</option><option value={2}>Telegram</option><option value={3}>Bark</option><option value={4}>钉钉</option><option value={5}>PushDeer</option><option value={6}>飞书</option><option value={7}>企微机器人</option><option value={8}>企微应用</option><option value={9}>Gotify</option><option value={10}>ServerChan</option><option value={11}>PushPlus</option><option value={12}>WxPusher</option><option value={13}>Pushover</option><option value={14}>Inotify</option><option value={15}>SMTP Proxy</option></select></label>
              <label className="full-field"><span>URL</span><textarea value={activeChannelData.url || ''} onChange={(event) => patchChannel({url: event.target.value})} /></label>
              <label><span>参数1</span><input value={activeChannelData.key1 || ''} onChange={(event) => patchChannel({key1: event.target.value})} /></label>
              <label><span>参数2</span><input value={activeChannelData.key2 || ''} onChange={(event) => patchChannel({key2: event.target.value})} /></label>
              <label className="full-field"><span>模板</span><textarea value={activeChannelData.customBody || defaultChannelTemplate} onChange={(event) => patchChannel({customBody: event.target.value})} /></label>
            </div>
          </div>

          <div className="serial-ota-bar"><input value={otaUrl} onChange={(event) => setOtaUrl(event.target.value)} placeholder="OTA 固件 URL" /><button className="secondary-button" onClick={() => void upgradeSerialPorts()} disabled={!otaUrl.trim() || !selectedPorts.some((port) => connectedPorts.includes(port))}><Download size={15} />全部已选设备 OTA</button></div>
          <div className="compact-footer-actions">
            <button className="primary-action" onClick={() => void saveSelectedPorts()} disabled={loading || !selectedPorts.some((port) => connectedPorts.includes(port))}><Save size={16} />批量保存完整配置（{selectedPorts.filter((port) => connectedPorts.includes(port)).length}）</button>
            <button className="secondary-button" onClick={() => void runProbe()} disabled={!selectedConnected}><Activity size={15} />诊断</button>
            <button className="secondary-button" onClick={() => void toggleLines(!status?.dtrEnabled, Boolean(status?.rtsEnabled))} disabled={!selectedConnected}>DTR</button>
            <button className="secondary-button" onClick={() => void toggleLines(Boolean(status?.dtrEnabled), !status?.rtsEnabled)} disabled={!selectedConnected}>RTS</button>
            <button className="secondary-button danger-button" onClick={() => void resetDevice()} disabled={!selectedConnected}>复位</button>
          </div>
        </main>

      </div>

      <section className="serial-panel compact-log-panel serial-log-bottom">
        <div className="panel-title compact-title"><div><h2><RadioReceiver size={17} /> 串口日志</h2><p>{activePort || '未选择串口'} · {streamMode === 'ws' ? '实时流' : '轮询'} · RX {rxCount} / TX {txCount}</p></div><span className="log-count">{logs.length}</span></div>
        <div className="terminal-surface compact-terminal bottom-terminal">
          {visibleLogs.length === 0 ? <div className="empty terminal-empty">连接后显示日志</div> : visibleLogs.map((item, index) => (
            <div className={`terminal-row terminal-row-${item.level}`} key={`${item.id || item.time}-${index}`}>
              <span className="terminal-level">{logLabel(item.level)}</span>
              <code>{item.content}</code>
              <span className="terminal-time">{timeLabel(item.time)}</span>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
