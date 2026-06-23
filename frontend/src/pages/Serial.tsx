import {useEffect, useMemo, useRef, useState} from 'react';
import {Activity, Cable, Copy, Download, FileDown, FileUp, Plug, RadioReceiver, RefreshCw, Save, Unplug, Wifi} from 'lucide-react';
import {connectSerial, disconnectSerial, getSerialLogs, getSerialStatus, listSerialPorts, probeSerial, readSerialDeviceConfig, resetSerialDevice, sendSerialOfflineConfig, setSerialControlLines, type SerialDeviceConfig, type SerialLogItem, type SerialOfflineChannel, type SerialPortItem, type SerialSessionStatus, type SerialStatus} from '../api/serial';
import {checkDeviceFirmwareVersion} from '../api/devices';

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleTimeString('zh-CN', {hour12: false}) : '--:--:--';
}

function logLabel(level: SerialLogItem['level']) {
  const labels = {rx: '接收', tx: '发送', system: '系统', error: '错误'};
  return labels[level] || level;
}

function defaultChannels() {
  return Array.from({length: 5}, (_, index) => ({enabled: false, type: 0, name: `通道 ${index + 1}`, url: '', key1: '', key2: '', customBody: ''}));
}

function normalizeChannels(channels?: SerialOfflineChannel[]) {
  const loaded = (channels || []).map((ch) => ({
    enabled: ch.enabled,
    type: ch.type,
    name: ch.name || '',
    url: ch.url || '',
    key1: ch.key1 || '',
    key2: ch.key2 || '',
    customBody: ch.customBody || '',
  }));
  while (loaded.length < 5) loaded.push({enabled: false, type: 0, name: `通道 ${loaded.length + 1}`, url: '', key1: '', key2: '', customBody: ''});
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
  const [networkMode, setNetworkMode] = useState(0);
  const [networkModeTouched, setNetworkModeTouched] = useState(false);
  const [sim1Pin, setSim1Pin] = useState('');
  const [sim2Pin, setSim2Pin] = useState('');
  const [sim1PinSet, setSim1PinSet] = useState(false);
  const [sim2PinSet, setSim2PinSet] = useState(false);
  const [channels, setChannels] = useState<SerialOfflineChannel[]>(defaultChannels);
  const [channelsTouched, setChannelsTouched] = useState(false);
  const [activeChannel, setActiveChannel] = useState(0);
  const [lastConfig, setLastConfig] = useState<SerialDeviceConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [firmwareVersion, setFirmwareVersion] = useState('');

  const sessions = status?.sessions || [];
  const currentSession = sessions.find((item) => item.port === activePort);
  const selectedConnected = Boolean(status?.connected && status.port === activePort);
  const activeChannelData = channels[activeChannel] || {};
  const rxCount = useMemo(() => logs.filter((item) => item.level === 'rx').length, [logs]);
  const txCount = useMemo(() => logs.filter((item) => item.level === 'tx').length, [logs]);
  const visibleLogs = useMemo(() => [...logs].reverse().slice(0, 200), [logs]);
  const connectedPorts = useMemo(() => sessions.filter((item) => item.connected).map((item) => item.port), [sessions]);

  const applyConfig = (cfg: SerialDeviceConfig) => {
    if (cfg.deviceName) setDeviceName(cfg.deviceName);
    if (typeof cfg.networkMode === 'number') setNetworkMode(cfg.networkMode);
    setNetworkModeTouched(false);
    setSim1Pin(cfg.sim1Pin || '');
    setSim2Pin(cfg.sim2Pin || '');
    setSim1PinSet(Boolean(cfg.sim1PinSet));
    setSim2PinSet(Boolean(cfg.sim2PinSet));
    setChannels(normalizeChannels(cfg.pushChannels));
    setChannelsTouched(false);
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
    setNotice('串口页当前仅显示本地串口状态与配置；固件版本检测与批量升级请在 LAN 设备页执行。');
  };



  const saveOfflineConfig = async (port = activePort, forceConfig?: SerialDeviceConfig) => {
    if (!port) return;
    setError('');
    setNotice('');
    try {
      const payload = forceConfig ? {
        port,
        deviceName: forceConfig.deviceName || '',
        networkMode: forceConfig.networkMode,
        pushChannels: forceConfig.pushChannels,
        sim1Pin: forceConfig.sim1Pin || '',
        sim2Pin: forceConfig.sim2Pin || '',
      } : {
        port,
        deviceName: deviceName.trim(),
        wifiSsid: wifiSsid.trim(),
        wifiPassword,
        networkMode: networkModeTouched ? networkMode : undefined,
        pushChannels: channelsTouched ? channels : undefined,
        sim1Pin: sim1Pin.trim(),
        sim2Pin: sim2Pin.trim(),
      };
      const result = await sendSerialOfflineConfig(payload);
      setNotice(`${port}: ${result.message || '配置已发送'}`);
      await loadLogs(port);
    } catch (err) {
      setError(err instanceof Error ? err.message : '配置发送失败');
    }
  };

  const cloneToOtherPorts = async () => {
    const cfg = lastConfig || {deviceName: deviceName.trim(), networkMode, pushChannels: channels, sim1Pin: sim1Pin.trim(), sim2Pin: sim2Pin.trim()};
    const targets = connectedPorts.filter((item) => item !== activePort);
    if (!targets.length) {
      setError('没有其它已连接串口可复刻');
      return;
    }
    setLoading(true);
    setError('');
    try {
      for (const target of targets) await saveOfflineConfig(target, cfg);
      setNotice(`已复刻到 ${targets.length} 个串口`);
    } finally {
      setLoading(false);
    }
  };

  const exportConfig = () => {
    const cfg = lastConfig || {deviceName: deviceName.trim(), networkMode, pushChannels: channels, sim1Pin: sim1Pin.trim(), sim2Pin: sim2Pin.trim()};
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
      applyConfig(cfg);
      setNotice('配置文件已导入，可写入当前串口或复刻到其它串口');
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
    return (
      <button key={item.name} className={`multi-port-card ${activePort === item.name ? 'active' : ''} ${connected ? 'connected' : ''}`} onClick={() => void selectPort(item.name)}>
        <span className="multi-port-dot" />
        <strong>{item.name}</strong>
        <small>{item.description}</small>
        <em>{connected ? `${session?.baudrate || baudrate} · ${session?.logCount || 0} 条` : '未连接'}</em>
      </button>
    );
  };

  return (
    <section className="page serial-page compact-serial-page">
      <div className="serial-hero compact-hero">
        <div>
          <span className="eyebrow">Serial Desk</span>
          <h1>串口工作台</h1>
          <p>轻量管理多个串口，读取配置、复刻配置、导入导出文件。</p>
        </div>
        <div className="serial-hero-actions">
          <button className="secondary-button" onClick={() => void refreshAll(activePort)} disabled={loading}><RefreshCw size={16} />刷新</button>
          <button className="primary-action" onClick={() => void connect(activePort)} disabled={loading || !activePort || selectedConnected}><Plug size={16} />连接当前</button>
        </div>
      </div>

      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      <div className="multi-serial-layout">
        <aside className="serial-panel multi-port-panel">
          <div className="panel-title compact-title"><div><h2><Cable size={17} /> 串口列表</h2><p>{connectedPorts.length} 个已连接</p></div></div>
          <div className="multi-port-list">{ports.length ? ports.map(renderPortCard) : <div className="empty">未发现串口</div>}</div>
          <div className="compact-connect-box">
            <label><span>波特率</span><input type="number" value={baudrate} min={1} onChange={(event) => setBaudrate(Number(event.target.value) || 115200)} disabled={selectedConnected} /></label>
            <label><span>模式</span><select value={cdcMode ? 'cdc' : safeMode ? 'safe' : 'normal'} onChange={(event) => { setCdcMode(event.target.value === 'cdc'); setSafeMode(event.target.value !== 'normal'); }} disabled={selectedConnected}><option value="cdc">稳定连接</option><option value="safe">防复位</option><option value="normal">标准</option></select></label>
            <div className="compact-button-row">
              {selectedConnected ? <button className="secondary-button danger-button" onClick={() => void disconnect(activePort)}><Unplug size={15} />断开</button> : <button className="secondary-button" onClick={() => void connect(activePort)} disabled={!activePort}><Plug size={15} />连接</button>}
              <button className="secondary-button" onClick={() => void loadDeviceConfig(activePort)} disabled={!selectedConnected}><Download size={15} />读取</button>
            <button className="secondary-button" onClick={() => void checkFirmwareVersion()}><Save size={15} />版本说明</button>
            </div>
          </div>
        </aside>

        <main className="serial-panel compact-config-panel">
          <div className="panel-title compact-title">
            <div><h2><Wifi size={17} /> 配置编辑</h2><p>{activePort || '请选择串口'} · {configLoaded ? '已读取' : '未读取'}</p></div>
            <div className="compact-actions">
              <button className="secondary-button" onClick={exportConfig}><FileDown size={15} />导出</button>
              <button className="secondary-button" onClick={() => fileInputRef.current?.click()}><FileUp size={15} />导入</button>
              <button className="secondary-button" onClick={() => void cloneToOtherPorts()} disabled={!selectedConnected || connectedPorts.length < 2}><Copy size={15} />复刻</button>
              <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void importConfig(event.target.files?.[0])} />
            </div>
          </div>

          <div className="compact-grid">
            <label><span>设备名称</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="例如 Node-01" /></label>
            <label><span>WiFi 名称</span><input value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} placeholder="SSID" /></label>
            <label><span>WiFi 密码</span><input type="password" value={wifiPassword} onChange={(event) => setWifiPassword(event.target.value)} placeholder="留空则不改" /></label>
            <label><span>网络模式</span><select value={networkMode} onChange={(event) => { setNetworkMode(Number(event.target.value)); setNetworkModeTouched(true); }}><option value={0}>自动</option><option value={1}>WiFi only</option><option value={2}>4G only</option></select></label>
            <label><span>SIM1 PIN</span><input type="password" value={sim1Pin} onChange={(event) => setSim1Pin(event.target.value)} placeholder={sim1PinSet ? '已设置，留空不改' : '未设置'} /></label>
            <label><span>SIM2 PIN</span><input type="password" value={sim2Pin} onChange={(event) => setSim2Pin(event.target.value)} placeholder={sim2PinSet ? '已设置，留空不改' : '未设置'} /></label>
          </div>

          <div className="mini-channel-shell">
            <div className="channel-tabs serial-channel-tabs compact-tabs">{channels.map((_, index) => <button key={index} className={activeChannel === index ? 'active' : ''} onClick={() => setActiveChannel(index)}>通道 {index + 1}</button>)}</div>
            <div className="compact-grid channel-compact-grid">
              <label><span>名称</span><input value={activeChannelData.name || ''} onChange={(event) => patchChannel({name: event.target.value})} /></label>
              <label><span>类型</span><select value={activeChannelData.type || 0} onChange={(event) => patchChannel({type: Number(event.target.value)})}><option value={0}>关闭</option><option value={1}>Webhook</option><option value={2}>Telegram</option><option value={3}>Bark</option><option value={4}>钉钉</option><option value={5}>PushDeer</option><option value={6}>飞书</option><option value={7}>企微机器人</option><option value={8}>企微应用</option><option value={9}>Gotify</option><option value={10}>ServerChan</option><option value={11}>PushPlus</option><option value={12}>WxPusher</option><option value={13}>Pushover</option><option value={14}>Inotify</option><option value={15}>SMTP Proxy</option></select></label>
              <label className="full-field"><span>URL</span><textarea value={activeChannelData.url || ''} onChange={(event) => patchChannel({url: event.target.value})} /></label>
              <label><span>参数1</span><input value={activeChannelData.key1 || ''} onChange={(event) => patchChannel({key1: event.target.value})} /></label>
              <label><span>参数2</span><input value={activeChannelData.key2 || ''} onChange={(event) => patchChannel({key2: event.target.value})} /></label>
              <label className="full-field"><span>模板</span><textarea value={activeChannelData.customBody || ''} onChange={(event) => patchChannel({customBody: event.target.value})} /></label>
            </div>
          </div>

          <div className="compact-footer-actions">
            <button className="primary-action" onClick={() => void saveOfflineConfig(activePort)} disabled={!selectedConnected}><Save size={16} />写入当前串口</button>
            <button className="secondary-button" onClick={() => void runProbe()} disabled={!selectedConnected}><Activity size={15} />诊断</button>
            <button className="secondary-button" onClick={() => void toggleLines(!status?.dtrEnabled, Boolean(status?.rtsEnabled))} disabled={!selectedConnected}>DTR</button>
            <button className="secondary-button" onClick={() => void toggleLines(Boolean(status?.dtrEnabled), !status?.rtsEnabled)} disabled={!selectedConnected}>RTS</button>
            <button className="secondary-button danger-button" onClick={() => void resetDevice()} disabled={!selectedConnected}>复位</button>
          </div>
        </main>

        <aside className="serial-panel compact-log-panel">
          <div className="panel-title compact-title"><div><h2><RadioReceiver size={17} /> 日志</h2><p>{streamMode === 'ws' ? '实时' : '轮询'} · RX {rxCount} / TX {txCount}</p></div><span className="log-count">{logs.length}</span></div>
          <div className="terminal-surface compact-terminal">
            {visibleLogs.length === 0 ? <div className="empty terminal-empty">连接后显示日志</div> : visibleLogs.map((item, index) => (
              <div className={`terminal-row terminal-row-${item.level}`} key={`${item.id || item.time}-${index}`}>
                <span className="terminal-level">{logLabel(item.level)}</span>
                <code>{item.content}</code>
                <span className="terminal-time">{timeLabel(item.time)}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
