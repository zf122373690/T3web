import {useEffect, useMemo, useRef, useState} from 'react';
import {RefreshCw, Settings2, Send, FileText, Power, MapPin, Monitor, Trash2, Plus, Radar, Search, DownloadCloud, Save} from 'lucide-react';
import SelfUpdateBar from '../components/SelfUpdateBar';
import {
  addDevice,
  bulkDeleteDevices,
  batchCheckDeviceOta,
  batchStartDeviceOta,
  checkDeviceFirmwareVersion,
  checkDeviceOta,
  clearDeviceMessages,
  deleteDevice,
  detectLanCidr,
  factoryResetDevice,
  getDeviceDiag,
  getDeviceDdns,
  getDeviceMessages,
  getDeviceOtaProgress,
  getDeviceTakeover,
  getSystemVersion,
  listDevices,
  pushTestDevice,
  rebootManagedDevice,
  refreshDevice,
  sendDeviceAt,
  sendDeviceSms,
  startDeviceOta,
  startScan,
  getScanStatus,
  updateDeviceConfig,
  updateDeviceDdns,
  updateDeviceSimNumber,
  updateDeviceWifi,
  type DeviceItem,
  type DeviceMessageItem,
  type FirmwareOtaResult,
  type SystemVersionInfo,
  type T3Config,
  type T3MqttConfig,
  type T3Takeover,
} from '../api/devices';

const channelTypes = ['关闭', 'Webhook/POST', 'Telegram', 'Bark', '钉钉', 'PushDeer', '飞书', '企微机器人', '企微应用', 'Gotify', 'ServerChan', 'PushPlus', 'WxPusher', 'Pushover', 'Inotify', 'Next SMTP Proxy'];
const defaultChannelTemplate = '【{{设备名称}}】{{事件标题}}\n号码: {{号码}}\n内容: {{内容}}\n时间: {{时间}}\n来源: SIM{{卡槽}} {{卡号}}\n备注: {{备注}}';

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
      url: config?.pushChannels?.[index]?.url || '',
      key1: config?.pushChannels?.[index]?.key1 || '',
      key2: config?.pushChannels?.[index]?.key2 || '',
      customBody: config?.pushChannels?.[index]?.customBody || defaultChannelTemplate,
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
  const payload = {...config, mqtt};
  if (!payload.sim1Pin?.trim()) delete payload.sim1Pin;
  if (!payload.sim2Pin?.trim()) delete payload.sim2Pin;
  return payload;
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
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [atCommand, setAtCommand] = useState('AT');
  const [atResponse, setAtResponse] = useState('');
  const [configReady, setConfigReady] = useState(false);
  const [otaUrl, setOtaUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [content, setContent] = useState('');
  const [simSlot, setSimSlot] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [networkPrefix, setNetworkPrefix] = useState('');
  const [startIp, setStartIp] = useState('1');
  const [endIp, setEndIp] = useState('254');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [versionInfo, setVersionInfo] = useState<SystemVersionInfo | null>(null);
  const [batchOtaUrl, setBatchOtaUrl] = useState('');
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState(0);
  const scanTimer = useRef<number | null>(null);
  const scanningRef = useRef(false);

  // 原始诊断
  const [diagResponse, setDiagResponse] = useState<Record<string, string> | null>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  // 推送测试
  const [pushChannel, setPushChannel] = useState(0);
  const [pushResult, setPushResult] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  // DDNS 维护
  const [ddnsData, setDdnsData] = useState<Record<string, string | number | boolean> | null>(null);
  const [ddnsBusy, setDdnsBusy] = useState(false);
  // OTA 进度
  const [otaProgressData, setOtaProgressData] = useState<{running?: boolean; finished?: boolean; success?: boolean; loaded?: number; total?: number; percent?: number; message?: string} | null>(null);
  // 设备消息日志
  const [deviceMessages, setDeviceMessages] = useState<DeviceMessageItem[]>([]);
  const [messagesBusy, setMessagesBusy] = useState(false);

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

  const load = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await listDevices();
      setItems(data.items);
      setTakeoverDevice((current) => current ? data.items.find((item) => item.id === current.id) || current : current);
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const refreshAll = async (silent = false) => {
    // 对齐 lvyou_smsweb：刷新只读本地库，不访问设备
    await load(silent);
    if (!silent) setNotice('已刷新本地列表（未访问设备）');
    setLastAutoRefreshAt(Date.now());
  };

  useEffect(() => {
    scanningRef.current = scanning;
  }, [scanning]);

  useEffect(() => {
    void load();
    void getSystemVersion().then(setVersionInfo).catch(() => setVersionInfo(null));
    return () => {
      if (scanTimer.current !== null) window.clearInterval(scanTimer.current);
    };
  }, []);


  const scan = async () => {
    const prefix = networkPrefix.trim();
    const start = Number(startIp);
    const end = Number(endIp);
    const cidr = prefix.endsWith('.') ? `${prefix}0/24` : prefix;
    if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(cidr)) {
      setError('网段前缀格式无效，例如 192.168.123.');
      return;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 254 || start > end) {
      setError('IP 范围必须为 1-254，且起始 IP 不大于结束 IP');
      return;
    }
    if (scanTimer.current !== null) window.clearInterval(scanTimer.current);
    setScanning(true);
    setError('');
    setNotice('');
    setScanProgress('正在启动扫描...');
    try {
      const started = await startScan({cidr, startIp: start, endIp: end});
      setScanProgress(`扫描 0/${started.total}，发现 0 台设备`);
      scanTimer.current = window.setInterval(async () => {
        try {
          const status = await getScanStatus(started.scanId);
          const completed = status.total - status.pending;
          setScanProgress(`扫描 ${completed}/${status.total}，发现 ${status.found} 台设备`);
          if (status.done || status.pending <= 0) {
            if (scanTimer.current !== null) window.clearInterval(scanTimer.current);
            scanTimer.current = null;
            setScanning(false);
            await load();
            setNotice(`扫描完成，发现 ${status.found} 台设备`);
          }
        } catch (err) {
          if (scanTimer.current !== null) window.clearInterval(scanTimer.current);
          scanTimer.current = null;
          setScanning(false);
          setError(err instanceof Error ? err.message : '扫描状态获取失败');
        }
      }, 1000);
    } catch (err) {
      setScanning(false);
      setScanProgress('');
      setError(err instanceof Error ? err.message : '启动扫描失败');
    }
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
    const ip = `${networkPrefix}${startIp}`;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await addDevice({ip});
      await load();
      setNotice(`设备 ${ip} 已添加`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    } finally {
      setLoading(false);
    }
  };

  const autoDetectLan = async () => {
    setError('');
    setNotice('');
    try {
      const data = await detectLanCidr();
      if (!data.prefix) {
        setError('未检测到局域网，请手动输入网段');
        return;
      }
      setNetworkPrefix(data.prefix);
      setNotice(`已检测到局域网网段：${data.cidr}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '未检测到局域网，请手动输入网段');
    }
  };

  const refresh = async (device: DeviceItem) => {
    await runAction(device, async () => {
      const updated = await refreshDevice(device.id);
      setItems((current) => current.map((item) => (item.id === device.id ? updated : item)));
      setTakeoverDevice((current) => current?.id === device.id ? updated : current);
      return {message: '设备状态已刷新'};
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

  const updateBatchBar = () => {
    const cbs = document.querySelectorAll('.dev-sel:checked');
    const bar = document.getElementById('batch-bar');
    const cnt = document.getElementById('batch-count');
    if (bar) bar.style.display = cbs.length > 0 ? 'flex' : 'none';
    if (cnt) cnt.textContent = String(cbs.length);
  };

  const getSelectedIds = () => [...document.querySelectorAll('.dev-sel:checked')].map((cb: any) => Number(cb.value));

  const batchReboot = async () => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (!confirm(`确认重启选中的 ${ids.length} 台设备？`)) return;
    let ok = 0, fail = 0;
    for (const id of ids) {
      const d = items.find((x) => x.id === id);
      if (!d) continue;
      try { const r = await fetch(`http://${d.ip}/api/reboot`, {method: 'POST', headers: {'Authorization': 'Basic ' + btoa('admin:admin')}}); r.ok ? ok++ : fail++; } catch { fail++; }
    }
    setNotice(`重启指令已下发：成功 ${ok} 台${fail > 0 ? '，失败 ' + fail + ' 台' : ''}`);
    (document.getElementById('sel-all') as any).checked = false;
    document.querySelectorAll('.dev-sel').forEach((cb: any) => cb.checked = false);
    updateBatchBar();
  };

  const batchRemove = () => {
    const ids = getSelectedIds();
    if (ids.length === 0) return;
    if (!confirm(`确认删除选中的 ${ids.length} 台设备？`)) return;
    setItems((current) => current.filter((d) => !ids.includes(d.id)));
    setNotice(`已删除 ${ids.length} 台设备`);
    updateBatchBar();
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
    setWifiPassword('');
    setShowWifiPassword(false);
    try {
      const data = await getDeviceTakeover(device.id);
      setTakeover(data);
      if (data.device) {
        setItems((current) => current.map((item) => (item.id === device.id ? data.device! : item)));
        setTakeoverDevice(data.device);
      }
      setConfig(defaultConfig(data.config));
      setConfigReady(Boolean(data.configReady));
      setWifiSsid(data.config.wifi?.ssid || data.status.wifi?.ssid || data.device?.wifi?.name || device.wifi.name || '');
      setWifiPassword(data.config.wifi?.password || '');
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
    await runAction(takeoverDevice, async () => {
      const result = await updateDeviceSimNumber(takeoverDevice.id, {slot, number});
      if (result.device) {
        setItems((current) => current.map((item) => (item.id === takeoverDevice.id ? result.device! : item)));
        setTakeoverDevice(result.device);
      }
      return result;
    }, 'SIM 号码写入失败');
  };

  const runAt = async () => {
    if (!takeoverDevice || !atCommand.trim()) return;
    await runAction(takeoverDevice, async () => {
      const result = await sendDeviceAt(takeoverDevice.id, {command: atCommand.trim(), timeout: 3000});
      setAtResponse(result.data?.response || result.message || 'OK');
      return result;
    }, 'AT 命令执行失败');
  };

  const upgradeDevice = async (device: DeviceItem) => {
    if (device.status !== 'online') return;
    setBusyId(device.id);
    setError('');
    setNotice('');
    try {
      const checked = await checkDeviceOta(device.id);
      setOtaResults((current) => ({
        ...current,
        [device.id]: {
          id: device.id,
          ip: device.ip,
          success: checked.success,
          message: checked.message,
          endpoint: checked.endpoint,
          data: checked.data,
        },
      }));
      if (!checked.data?.update) {
        setNotice(`${device.name || device.ip} 当前已是最新固件`);
        return;
      }
      const url = checked.data.url || batchOtaUrl.trim();
      if (!url) {
        setError('未获取到固件地址，请先在页面上方填写 OTA 固件 URL');
        return;
      }
      const version = checked.data.version ? ` ${checked.data.version}` : '';
      if (!window.confirm(`确认将 ${device.name || device.ip} 升级到${version || '最新固件'}？升级期间请勿断电。`)) return;
      const result = await startDeviceOta(device.id, url);
      setNotice(result.message || `${device.name || device.ip} OTA 升级已启动`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OTA 升级失败');
    } finally {
      setBusyId(null);
    }
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

  const batchUpgrade = async () => {
    const ids = items.filter((item) => item.status === 'online').map((item) => item.id);
    if (!ids.length) {
      setError('没有在线设备可升级');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const checked = await batchCheckDeviceOta(ids);
      const discoveredUrl = checked.items.find((item) => item.success && typeof item.data?.url === 'string' && item.data.url)?.data?.url as string | undefined;
      const url = batchOtaUrl.trim() || discoveredUrl || '';
      if (!url) {
        setError('OTA 服务器未返回固件地址，请填写 OTA 固件 URL 后重试');
        return;
      }
      const result = await batchStartDeviceOta(ids, url);
      const failed = result.items.filter((item) => !item.success);
      setNotice(`LAN OTA 已触发：成功 ${result.items.length - failed.length} 台，失败 ${failed.length} 台`);
      if (failed.length) setError(failed.map((item) => `${item.ip}：${item.message}`).join('；'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LAN 批量 OTA 失败');
    } finally {
      setLoading(false);
    }
  };

  // ===== 设备诊断 =====
  const runDiag = async () => {
    if (!takeoverDevice) return;
    setDiagBusy(true);
    try {
      const result = await getDeviceDiag(takeoverDevice.id);
      setDiagResponse(result.data);
    } catch (err) {
      setDiagResponse({'error': err instanceof Error ? err.message : '诊断获取失败'});
    } finally {
      setDiagBusy(false);
    }
  };

  // ===== 推送测试 =====
  const runPushTest = async () => {
    if (!takeoverDevice) return;
    setPushBusy(true);
    setPushResult('');
    try {
      const result = await pushTestDevice(takeoverDevice.id, pushChannel);
      setPushResult(result.message || (result.success ? '推送测试已发送' : '推送测试失败'));
    } catch (err) {
      setPushResult(err instanceof Error ? err.message : '推送测试失败');
    } finally {
      setPushBusy(false);
    }
  };

  // ===== DDNS 维护 =====
  const refreshDdns = async () => {
    if (!takeoverDevice) return;
    setDdnsBusy(true);
    try {
      const result = await getDeviceDdns(takeoverDevice.id);
      setDdnsData(result.data);
    } catch (err) {
      setDdnsData({'error': err instanceof Error ? err.message : 'DDNS 查询失败'});
    } finally {
      setDdnsBusy(false);
    }
  };

  const runDdnsUpdate = async () => {
    if (!takeoverDevice) return;
    setDdnsBusy(true);
    try {
      const result = await updateDeviceDdns(takeoverDevice.id);
      setDdnsData({'message': result.message || (result.success ? 'DDNS 更新已触发' : 'DDNS 更新失败')});
    } catch (err) {
      setDdnsData({'error': err instanceof Error ? err.message : 'DDNS 更新失败'});
    } finally {
      setDdnsBusy(false);
    }
  };

  // ===== OTA 进度 =====
  const refreshOtaProgress = async () => {
    if (!takeoverDevice) return;
    try {
      const result = await getDeviceOtaProgress(takeoverDevice.id);
      setOtaProgressData(result.data);
    } catch (err) {
      setOtaProgressData({message: err instanceof Error ? err.message : 'OTA 进度获取失败'});
    }
  };

  // ===== 设备消息日志 =====
  const refreshDeviceMessages = async (type = 'all') => {
    if (!takeoverDevice) return;
    setMessagesBusy(true);
    try {
      const result = await getDeviceMessages(takeoverDevice.id, type);
      setDeviceMessages(result.data);
    } catch (err) {
      setDeviceMessages([{type: 'error', msg: err instanceof Error ? err.message : '消息读取失败'}]);
    } finally {
      setMessagesBusy(false);
    }
  };

  return (
    <section className="page devices-page">
      <div className="version-banner"><span>T3服务端 {versionInfo?.localVersion || '检测中'}</span><span>OTA 服务器 {versionInfo?.otaServerVersion || versionInfo?.otaServerMessage || '检测中'}</span><span>当前设备版本 {items.filter((item) => item.status === 'online').map((item) => `${item.name || item.ip}: ${item.version || '-'}`).join('，') || '暂无在线设备'}</span></div>
      <SelfUpdateBar versionInfo={versionInfo} />
      <div className="batch-ota-bar"><input value={batchOtaUrl} onChange={(event) => setBatchOtaUrl(event.target.value)} placeholder="OTA 固件 URL，可留空使用设备检查结果" /><button className="btn-primary" onClick={() => void batchUpgrade()} disabled={loading || !items.some((item) => item.status === 'online')}><DownloadCloud size={15} />全部在线设备 OTA</button></div>

      <div className="stats-bar">
        <span className="stat-item"> 设备 {stats.total}</span>
        <span className="stat-item stat-online"> {stats.online}</span>
        <span className="stat-item">卡槽 {stats.simSlots}</span>
        <span className="stat-item stat-nosim">❌ 无卡 {stats.noSim}</span>
        <span className="stat-item stat-sim">🟡 插卡 {stats.withSim}</span>
        <span className="stat-item stat-registered">✅ 已注册 {stats.registered}</span>
        <span className="stat-item stat-auto-refresh">
          {lastAutoRefreshAt ? `⏱ 上次刷新 ${new Date(lastAutoRefreshAt).toLocaleTimeString('zh-CN', {hour12: false})}` : '⏱ 手动刷新本地列表'}
        </span>
      </div>

      {/* Scan Control Panel */}
      <div className="scan-control-panel">
        <div className="scan-inputs">
          <label>
            <span>网段前缀</span>
            <input value={networkPrefix} onChange={(e) => setNetworkPrefix(e.target.value)} placeholder="留空自动检测" />
          </label>
          <label>
            <span>起始IP</span>
            <input value={startIp} onChange={(e) => setStartIp(e.target.value)} placeholder="1" />
          </label>
          <label>
            <span>结束IP</span>
            <input value={endIp} onChange={(e) => setEndIp(e.target.value)} placeholder="254" />
          </label>
        </div>
        <div className="scan-hint">💡 网段前缀留空时，点击"自动检测"会自动识别当前局域网网段，无需手动输入。</div>
        <div className="scan-actions">
          <button className="btn-secondary" onClick={() => void autoDetectLan()}>🌐 自动检测</button>
          <button className="btn-primary" onClick={scan} disabled={loading || scanning}>🔍 {scanning ? '扫描中...' : '开始扫描'}</button>
          <button className="btn-secondary" onClick={() => void refreshAll()} disabled={loading || scanning}>🔄 刷新全部</button>
          <button className="btn-secondary" onClick={add} disabled={loading}>➕ 添加设备</button>
          <button className="btn-secondary" onClick={clearAll} disabled={loading}>🗑️ 清空列表</button>
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
      {scanProgress && <div className="success inline-error">{scanProgress}</div>}
      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      {/* 顶部功能选项 Tab */}

      {
        <>
          {/* Data Table */}
          <div className="table-card">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" id="sel-all" onChange={(e) => { document.querySelectorAll('.dev-sel').forEach((cb: any) => cb.checked = e.target.checked); updateBatchBar(); }} /></th>
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
                <td colSpan={8} className="empty">暂无设备，请先扫描或手动添加。</td>
              </tr>
            ) : filteredItems.map((device) => (
              <tr key={device.id}>
                <td><input type="checkbox" className="dev-sel" value={device.id} onChange={() => updateBatchBar()} /></td>
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
                  {(device.sim1?.present || device.sim1?.number || device.sim1?.operator || device.sim1?.iccid) ? (
                    <div className="sim-cell">
                      <div className="sim-num mono">{device.sim1.number || '未设置号码'}</div>
                      <small className="text-muted">
                        <span className="sim-op">{device.sim1.operator || '-'}</span>
                        {device.sim1.signal ? ` · ${device.sim1.signal}dBm` : ''}
                        {device.sim1.registered ? ' · 已注册' : ' · 未注册'}
                      </small>
                    </div>
                  ) : (
                    <span className="text-muted">无卡</span>
                  )}
                </td>
                <td>
                  {(device.sim2?.present || device.sim2?.number || device.sim2?.operator || device.sim2?.iccid) ? (
                    <div className="sim-cell">
                      <div className="sim-num mono">{device.sim2.number || '未设置号码'}</div>
                      <small className="text-muted">
                        <span className="sim-op">{device.sim2.operator || '-'}</span>
                        {device.sim2.signal ? ` · ${device.sim2.signal}dBm` : ''}
                        {device.sim2.registered ? ' · 已注册' : ' · 未注册'}
                      </small>
                    </div>
                  ) : (
                    <span className="text-muted">无卡</span>
                  )}
                </td>
                <td className="action-buttons">
                  <button className="btn-action" onClick={() => refresh(device)} disabled={busyId === device.id}>🔄 刷新</button>
                  <button className="btn-action" onClick={() => openTakeover(device)}>⚙️ 配置</button>
                  <button className="btn-action" onClick={() => setSmsDevice(device)}>💬 短信</button>
                  <button className="btn-action" onClick={() => void upgradeDevice(device)} disabled={device.status !== 'online' || busyId === device.id} title={device.status === 'online' ? '检查并升级设备固件' : '设备离线，无法升级'}>
                    <DownloadCloud size={14} /> {busyId === device.id ? '处理中' : 'OTA 升级'}
                  </button>
                  <button className="btn-action" onClick={() => runAction(device, () => rebootManagedDevice(device.id), '重启失败')} disabled={busyId === device.id}>⚡ 重启</button>
                  <button className="btn-action" onClick={() => window.open(`http://${device.ip}`, '_blank')}>🖥️ 后台</button>
                  <button className="btn-action btn-danger" onClick={() => remove(device)} disabled={busyId === device.id}>🗑️ 删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="batch-bar" id="batch-bar" style={{display: 'none'}}>
        <span id="batch-count">0</span> 台已选
        <button className="btn-action" onClick={batchReboot}>⚡ 批量重启</button>
        <button className="btn-action btn-danger" onClick={batchRemove}>🗑️ 批量删除</button>
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
                  <label>热点密码<div className="password-input-row"><input type={showWifiPassword ? 'text' : 'password'} value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="当前热点未设置密码" /><button type="button" className="btn-secondary" onClick={() => setShowWifiPassword((current) => !current)}>{showWifiPassword ? '隐藏' : '查看'}</button></div></label>
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
                  <label>TTS 播报<select value={config.callPlayEnabled ? 1 : 0} onChange={(e) => patchConfig({callPlayEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>TTS 内容<input value={config.callPlayFile || ''} onChange={(e) => patchConfig({callPlayFile: e.target.value})} placeholder="播报内容" /></label>
                </section>

                <section className="takeover-card wide">
                  <h3>📤 转发通道</h3>
                  <div className="channel-tabs">
                    {[0, 1, 2, 3, 4].map((i) => <button key={i} className={activeChannel === i ? 'active' : ''} onClick={() => setActiveChannel(i)}>通道 {i + 1}</button>)}
                  </div>
                  <label>类型<select value={config.pushChannels?.[activeChannel]?.type || 0} onChange={(e) => patchChannel({type: Number(e.target.value)})}>{channelTypes.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
                  <label>URL<textarea value={config.pushChannels?.[activeChannel]?.url || ''} onChange={(e) => patchChannel({url: e.target.value})} /></label>
                  <div className="takeover-two">
                    <label>参数1<input value={config.pushChannels?.[activeChannel]?.key1 || ''} onChange={(e) => patchChannel({key1: e.target.value})} /></label>
                    <label>参数2<input value={config.pushChannels?.[activeChannel]?.key2 || ''} onChange={(e) => patchChannel({key2: e.target.value})} /></label>
                  </div>
                  <label>模板<textarea value={config.pushChannels?.[activeChannel]?.customBody || ''} onChange={(e) => patchChannel({customBody: e.target.value})} /></label>
                  <label>录音上传<select value={config.pushChannels?.[activeChannel]?.recordUploadEnabled ? 1 : 0} onChange={(e) => patchChannel({recordUploadEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>录音上传 URL<input value={config.pushChannels?.[activeChannel]?.recordUrl || ''} onChange={(e) => patchChannel({recordUrl: e.target.value})} placeholder="录音文件上传地址" /></label>
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
                  <h3>☁️ Cloudflare DDNS</h3>
                  <div className="takeover-two">
                    <label>DDNS 开关<select value={config.ddnsEnabled ? 1 : 0} onChange={(e) => patchConfig({ddnsEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>更新间隔(分钟)<input type="number" value={config.ddnsInterval || 30} onChange={(e) => patchConfig({ddnsInterval: Number(e.target.value)})} min={5} max={1440} /></label>
                  </div>
                  <label>API Token<input type="password" value={config.ddnsApiToken || ''} onChange={(e) => patchConfig({ddnsApiToken: e.target.value})} placeholder="Cloudflare API Token" /></label>
                  <label>子域名<input value={config.ddnsSubDomain || ''} onChange={(e) => patchConfig({ddnsSubDomain: e.target.value})} placeholder="例如：t3.example.com" /></label>
                </section>

                <section className="takeover-card wide">
                  <h3>⚙️ 系统与维护</h3>
                  <div className="takeover-two">
                    <label>定时重启<select value={config.rebootEnabled ? 1 : 0} onChange={(e) => patchConfig({rebootEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>重启时间<div style={{display: 'flex', gap: 4, alignItems: 'center'}}><input type="number" value={config.rebootHour ?? 4} onChange={(e) => patchConfig({rebootHour: Number(e.target.value)})} min={0} max={23} style={{width: 50}} /><span>:</span><input type="number" value={config.rebootMinute ?? 0} onChange={(e) => patchConfig({rebootMinute: Number(e.target.value)})} min={0} max={59} style={{width: 50}} /></div></label>
                  </div>
                  <div className="takeover-two">
                    <label>短信控制<select value={config.smsControlEnabled ? 1 : 0} onChange={(e) => patchConfig({smsControlEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>管理员号码<input value={config.adminPhones || ''} onChange={(e) => patchConfig({adminPhones: e.target.value})} placeholder="逗号分隔" /></label>
                  </div>
                  <div className="takeover-two">
                    <label>短信清理<select value={config.smsCleanEnabled ? 1 : 0} onChange={(e) => patchConfig({smsCleanEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>清理阈值(%)<input type="number" value={config.smsCleanThreshold ?? 80} onChange={(e) => patchConfig({smsCleanThreshold: Number(e.target.value)})} /></label>
                  </div>
                  <div className="takeover-two">
                    <label>检测周期(分钟)<input type="number" value={config.smsCleanCheckInterval ?? 60} onChange={(e) => patchConfig({smsCleanCheckInterval: Number(e.target.value)})} /></label>
                    <label>保留条数<input type="number" value={config.smsCleanKeepCount ?? 50} onChange={(e) => patchConfig({smsCleanKeepCount: Number(e.target.value)})} /></label>
                  </div>
                  <label>Web 端口<input type="number" value={config.webPort ?? 80} onChange={(e) => patchConfig({webPort: Number(e.target.value)})} min={1} max={65535} placeholder="80" /></label>
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

                <section className="takeover-card accent-slate">
                  <h3>🩺 设备诊断</h3>
                  <div className="serial-command refined">
                    <button className="btn-secondary" onClick={runDiag} disabled={diagBusy}>运行诊断</button>
                  </div>
                  {diagResponse && (
                    <div className="diag-result">
                      {Object.entries(diagResponse).map(([k, v]) => (
                        <div className="diag-row" key={k}><span className="diag-key">{k}</span><span className="diag-val">{String(v)}</span></div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="takeover-card accent-green">
                  <h3>📨 推送测试</h3>
                  <label>测试通道
                    <select value={pushChannel} onChange={(e) => setPushChannel(Number(e.target.value))}>
                      <option value={0}>通道 1</option>
                      <option value={1}>通道 2</option>
                      <option value={2}>通道 3</option>
                      <option value={3}>通道 4</option>
                      <option value={4}>通道 5</option>
                    </select>
                  </label>
                  <div className="serial-command refined">
                    <button className="btn-primary" onClick={runPushTest} disabled={pushBusy}>发送测试推送</button>
                  </div>
                  {pushResult && <div className={`inline-error ${pushResult.includes('失败') ? 'error' : 'success'}`}>{pushResult}</div>}
                </section>

                <section className="takeover-card accent-amber">
                  <h3>🌐 DDNS 状态</h3>
                  <div className="serial-command refined">
                    <button className="btn-secondary" onClick={refreshDdns} disabled={ddnsBusy}>查询状态</button>
                    <button className="btn-secondary" onClick={runDdnsUpdate} disabled={ddnsBusy}>立即更新</button>
                  </div>
                  {ddnsData && (
                    <div className="diag-result">
                      {Object.entries(ddnsData).map(([k, v]) => (
                        <div className="diag-row" key={k}><span className="diag-key">{k}</span><span className="diag-val">{String(v)}</span></div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="takeover-card accent-red">
                  <h3>⬆️ OTA 进度</h3>
                  <div className="serial-command refined">
                    <button className="btn-secondary" onClick={refreshOtaProgress} disabled={!takeoverDevice}>刷新进度</button>
                  </div>
                  {otaProgressData && (
                    <div className="ota-progress">
                      {otaProgressData.message && <div className={`inline-error ${otaProgressData.success === false ? 'error' : 'success'}`}>{otaProgressData.message}</div>}
                      {otaProgressData.running && <div className="text-muted">状态: 升级中...</div>}
                      {typeof otaProgressData.percent === 'number' && (
                        <div className="ota-bar"><div className="ota-bar-fill" style={{width: `${otaProgressData.percent}%`}} />{otaProgressData.percent}%</div>
                      )}
                      {otaProgressData.finished && <div className={`inline-error ${otaProgressData.success ? 'success' : 'error'}`}>{otaProgressData.success ? 'OTA 升级完成' : 'OTA 升级失败'}</div>}
                    </div>
                  )}
                </section>

                <section className="takeover-card wide accent-blue">
                  <h3>📜 设备消息日志</h3>
                  <div className="serial-command refined">
                    <button className="btn-secondary" onClick={() => refreshDeviceMessages('all')} disabled={messagesBusy}>全部</button>
                    <button className="btn-secondary" onClick={() => refreshDeviceMessages('sms')} disabled={messagesBusy}>短信</button>
                    <button className="btn-secondary" onClick={() => refreshDeviceMessages('call')} disabled={messagesBusy}>通话</button>
                  </div>
                  <div className="msg-log">
                    {deviceMessages.length ? deviceMessages.map((m, idx) => (
                      <div className="msg-row" key={idx}>
                        {m.ts && <span className="msg-ts">{m.ts}</span>}
                        {m.sim && <span className="msg-sim">{m.sim}</span>}
                        {m.from && <span className="msg-from">{m.from}</span>}
                        {m.num && <span className="msg-from">{m.num}</span>}
                        <span className="msg-text">{m.msg || m.type || ''}</span>
                      </div>
                    )) : <div className="text-muted">暂无消息</div>}
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
        </>
      }

    </section>
  );
}
