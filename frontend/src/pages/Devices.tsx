import {useEffect, useMemo, useRef, useState} from 'react';
import {RefreshCw, Settings2, Send, FileText, Power, MapPin, Monitor, Trash2, Plus, Search, DownloadCloud, Save} from 'lucide-react';
import {channelMetaMap, channelTypes} from '../utils/channelMeta';
import {
  addDevice,
  bulkDeleteDevices,
  refreshAllDevices,
  batchCheckDeviceOta,
  batchStartDeviceOta,
  checkDeviceFirmwareVersion,
  checkDeviceOta,
  clearDeviceMessages,
  deleteDevice,
  factoryResetDevice,
  getDeviceOtaProgress,
  getDeviceTakeover,
  getScanStatus,
  listDevices,
  pushTestDevice,
  rebootManagedDevice,
  refreshDevice,
  sendDeviceSms,
  startDeviceOta,
  startScan,
  updateDeviceConfig,
  updateDeviceSimNumber,
  updateDeviceWifi,
  uploadDeviceOta,
  type DeviceItem,
  type FirmwareOtaResult,
  type ScanStatus,
  type T3Config,
  type T3MqttConfig,
  type T3Takeover,
} from '../api/devices';

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
    sim1CallAutoAnswer: config?.sim1CallAutoAnswer ?? Boolean(config?.callRecordAutoAnswer),
    sim2CallAutoAnswer: config?.sim2CallAutoAnswer ?? Boolean(config?.callRecordAutoAnswer),
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
    bootNotifyEnabled: config?.bootNotifyEnabled ?? true,
    bootNotifyTemplate: config?.bootNotifyTemplate || '',
    callNotifyTemplate: config?.callNotifyTemplate || '',
    webUser: config?.webUser || '',
    webPass: config?.webPass || '',
    sim1Remark: config?.sim1Remark || '',
    sim2Remark: config?.sim2Remark || '',
    sim1Pin: config?.sim1Pin || '',
    sim2Pin: config?.sim2Pin || '',
    sim1PinSet: config?.sim1PinSet || false,
    sim2PinSet: config?.sim2PinSet || false,
    smsWhitelistEnabled: Boolean(config?.smsWhitelistEnabled),
    smsWhitelistKeywords: config?.smsWhitelistKeywords || '',
    pushChannels: Array.from({length: 5}, (_, index) => ({
      enabled: Boolean(config?.pushChannels?.[index]?.enabled),
      type: config?.pushChannels?.[index]?.type || 0,
      url: config?.pushChannels?.[index]?.url || '',
      key1: config?.pushChannels?.[index]?.key1 || '',
      key2: config?.pushChannels?.[index]?.key2 || '',
      customBody: config?.pushChannels?.[index]?.customBody || defaultChannelTemplate,
      sim1Enabled: config?.pushChannels?.[index]?.sim1Enabled ?? true,
      sim2Enabled: config?.pushChannels?.[index]?.sim2Enabled ?? true,
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
  const [takeoverPane, setTakeoverPane] = useState('basic');
  const [config, setConfig] = useState<T3Config>(defaultConfig());
  const [activeChannel, setActiveChannel] = useState(0);
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [showWifiPassword, setShowWifiPassword] = useState(false);
  const [configReady, setConfigReady] = useState(false);
  const [otaUrl, setOtaUrl] = useState('');
  const [phone, setPhone] = useState('');
  const [content, setContent] = useState('');
  const [simSlot, setSimSlot] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addIp, setAddIp] = useState('');
  const [scanProgress, setScanProgress] = useState('');
  const [batchOtaUrl, setBatchOtaUrl] = useState('');
  const [lastAutoRefreshAt, setLastAutoRefreshAt] = useState(0);

  // 推送测试
  const [pushResult, setPushResult] = useState('');
  const [pushBusy, setPushBusy] = useState(false);
  // OTA 进度
  const [otaProgressData, setOtaProgressData] = useState<{running?: boolean; finished?: boolean; success?: boolean; loaded?: number; total?: number; percent?: number; message?: string} | null>(null);
  // 本地 OTA 上传
  const [otaFile, setOtaFile] = useState<File | null>(null);
  const [otaUploadBusy, setOtaUploadBusy] = useState(false);
  // 复制配置到其他设备
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyTargets, setCopyTargets] = useState<Set<number>>(new Set());
  const [copyBusy, setCopyBusy] = useState(false);
  // 局域网扫描
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCidr, setScanCidr] = useState('');
  const [scanStartIp, setScanStartIp] = useState('');
  const [scanEndIp, setScanEndIp] = useState('');
  const [scanUser, setScanUser] = useState('admin');
  const [scanPassword, setScanPassword] = useState('admin');
  const [scanRunning, setScanRunning] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const scanTimer = useRef<number | null>(null);

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

  // 状态筛选 chips
  const visibleItems = useMemo(() => {
    if (!filterStatus) return filteredItems;
    if (filterStatus === 'online') return filteredItems.filter((item) => item.status === 'online');
    if (filterStatus === 'offline') return filteredItems.filter((item) => item.status !== 'online');
    if (filterStatus === 'nosim') return filteredItems.filter((item) => !(item.sim1?.present || item.sim1?.number) && !(item.sim2?.present || item.sim2?.number));
    return filteredItems;
  }, [filteredItems, filterStatus]);

  // 当前编辑通道的字段元数据（type 0=关闭 时无 meta，隐藏 URL/参数）
  const chanMeta = channelMetaMap[config.pushChannels?.[activeChannel]?.type || 0];

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
    // 并发 TCP 探测每台设备端口并更新在线状态（后端完成，不发 HTTP 请求）
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const data = await refreshAllDevices();
      setItems(data.items);
      setTakeoverDevice((current) => current ? data.items.find((item) => item.id === current.id) || current : current);
      if (!silent) setNotice('已探测并更新设备在线状态');
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : '刷新失败');
    } finally {
      if (!silent) setLoading(false);
    }
    setLastAutoRefreshAt(Date.now());
  };

  // 每 15 秒静默探测一次设备在线状态；切回前台时立即探测，页面打开先用旧状态、再即时纠正
  useEffect(() => {
    const probe = () => { if (document.visibilityState === 'visible') void refreshAll(true); };
    const timer = window.setInterval(probe, 15000);
    const onVis = () => { if (document.visibilityState === 'visible') void refreshAll(true); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  useEffect(() => {
    void load();
    // 挂载后立即探测一次，避免一直显示上一次会话留下的旧在线状态
    void refreshAll(true);
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
    setTakeoverPane('basic');
    setError('');
    setNotice('');
    setConfigReady(false);
    setOtaFile(null);
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

  const copyConfigToDevices = async () => {
    if (!takeoverDevice || copyTargets.size === 0) return;
    setCopyBusy(true);
    const payload = configPayload(config);
    delete payload.deviceName;
    let successCount = 0;
    let failCount = 0;
    for (const targetId of copyTargets) {
      try {
        await updateDeviceConfig(targetId, payload);
        successCount++;
      } catch {
        failCount++;
      }
    }
    setCopyBusy(false);
    setCopyDialogOpen(false);
    setCopyTargets(new Set());
    if (failCount === 0) {
      setNotice(`配置已成功复制到 ${successCount} 台设备`);
    } else {
      setError(`复制完成：${successCount} 台成功，${failCount} 台失败`);
    }
  };

  const stopScanTimer = () => {
    if (scanTimer.current) {
      window.clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
  };

  const runScan = async () => {
    stopScanTimer();
    setScanRunning(true);
    setError('');
    setScanStatus(null);
    setScanProgress('');
    try {
      const payload: {cidr?: string; startIp?: number; endIp?: number; user?: string; password?: string} = {user: scanUser, password: scanPassword};
      if (scanCidr.trim()) {
        payload.cidr = scanCidr.trim();
      } else if (scanStartIp.trim() && scanEndIp.trim()) {
        const startParts = scanStartIp.trim().split('.');
        const endParts = scanEndIp.trim().split('.');
        const startNum = startParts.length === 4 ? parseInt(startParts[3]) : undefined;
        const endNum = endParts.length === 4 ? parseInt(endParts[3]) : undefined;
        if (startNum !== undefined && endNum !== undefined) {
          payload.startIp = startNum;
          payload.endIp = endNum;
          payload.cidr = startParts.slice(0, 3).join('.');
        }
      }
      const started = await startScan(payload);
      setScanStatus({
        id: started.scanId,
        cidr: started.cidr,
        total: started.total,
        pending: started.total,
        found: 0,
        failed: 0,
        done: false,
        results: [],
      });
      setScanProgress(`扫描中... 0/${started.total}`);
      scanTimer.current = window.setInterval(async () => {
        try {
          const next = await getScanStatus(started.scanId);
          setScanStatus(next);
          setScanProgress(`扫描中... ${next.total - next.pending}/${next.total}，发现 ${next.found} 台`);
          if (next.done || next.pending <= 0) {
            setScanRunning(false);
            stopScanTimer();
            setScanProgress(`扫描完成：发现 ${next.found} 台设备`);
            await load(true);
          }
        } catch (err) {
          setScanRunning(false);
          stopScanTimer();
          setError(err instanceof Error ? err.message : '扫描状态获取失败');
        }
      }, 1000);
    } catch (err) {
      setScanRunning(false);
      setError(err instanceof Error ? err.message : '启动扫描失败');
    }
  };

  const claimScannedDevice = async (ip: string) => {
    try {
      await addDevice({ip, user: scanUser, password: scanPassword});
      setScanStatus((current) => {
        if (!current) return current;
        return {
          ...current,
          results: current.results.map((item) => item.ip === ip ? {...item, success: true, candidate: true, autoSaved: true} : item),
        };
      });
      setNotice(`设备 ${ip} 已添加`);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '添加失败');
    }
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

  // ===== 推送测试 =====
  const runPushTest = async () => {
    if (!takeoverDevice) return;
    setPushBusy(true);
    setPushResult('');
    try {
      const result = await pushTestDevice(takeoverDevice.id, activeChannel);
      setPushResult(result.message || (result.success ? '推送测试已发送' : '推送测试失败'));
    } catch (err) {
      setPushResult(err instanceof Error ? err.message : '推送测试失败');
    } finally {
      setPushBusy(false);
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


  // ===== 本地 OTA 上传 =====
  const runOtaUpload = async () => {
    if (!takeoverDevice || !otaFile) return;
    if (!confirm(`确认将本地固件「${otaFile.name}」上传刷写到设备？升级期间请勿断电。`)) return;
    setOtaUploadBusy(true);
    try {
      const result = await uploadDeviceOta(takeoverDevice.id, otaFile);
      setNotice(result.message || '固件上传成功，设备重启中');
      setOtaFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '固件上传失败');
    } finally {
      setOtaUploadBusy(false);
    }
  };

  return (
    <section className="page devices-page">
      <div className="stats-bar">
        <span className="stat-item stat-online">在线 {stats.online}/{stats.total}</span>
        <span className="stat-item stat-sim">插卡 {stats.withSim}</span>
        <span className="stat-item stat-nosim">无卡 {stats.noSim}</span>
        <span className="stat-item stat-registered">已注册 {stats.registered}</span>
        <button
          className="stat-item stat-auto-refresh"
          onClick={() => void refreshAll()}
          disabled={loading}
          title="探测全部设备端口并更新在线状态"
        >
          <RefreshCw size={12} className={loading ? 'spin' : ''} />
          {loading ? '探测中…' : lastAutoRefreshAt ? `上次刷新 ${new Date(lastAutoRefreshAt).toLocaleTimeString('zh-CN', {hour12: false})}` : '刷新在线状态'}
        </button>
        <button
          className="stat-item stat-auto-refresh"
          onClick={() => void batchUpgrade()}
          disabled={loading}
          title="对全部在线设备检查并触发固件升级"
        >
          ⚡ 全部在线 OTA
        </button>
        <button
          className="stat-item stat-auto-refresh"
          onClick={() => { setScanOpen(true); setScanStatus(null); setScanProgress(''); }}
          disabled={scanRunning}
          title="扫描局域网内的 T3 设备"
        >
          🔍 扫描发现
        </button>
      </div>

      {/* 筛选 chips */}
      <div className="filter-chips">
        {([['', '全部'], ['online', '在线'], ['offline', '离线'], ['nosim', '无卡']] as Array<[string, string]>).map(([value, label]) => (
          <button key={label} className={`chip ${filterStatus === value ? 'active' : ''}`} onClick={() => setFilterStatus(value)}>{label}</button>
        ))}
      </div>

      {/* Search Bar */}
      <div className="search-bar">
        <Search size={16} className="search-icon" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索编号 / 号码 / IP / 备注"
        />
      </div>

      {/* Error/Notice */}
      {scanProgress && <div className="success inline-error">{scanProgress}</div>}
      {error && <div className="error inline-error">{error}</div>}
      {notice && <div className="success inline-error">{notice}</div>}

      {/* Device Cards */}
      <div className="device-list">
        {visibleItems.length === 0 ? (
          <div className="empty">暂无设备，点击右下角 + 扫描或手动添加。</div>
        ) : visibleItems.map((device) => {
          const online = device.status === 'online';
          return (
            <div key={device.id} className={`dev-card ${online ? 'online' : 'offline'}`}>
              <div className="dev-card-top">
                <input type="checkbox" className="dev-sel dev-card-check" value={device.id} onChange={() => updateBatchBar()} />
                <span className="dev-dot" />
                <strong>{device.name || device.ip}</strong>
                <span className={`dev-badge ${online ? '' : 'off'}`}>
                  {online ? '在线' : '离线'}
                  {!online && device.lastSeen ? ` · ${timeLabel(device.lastSeen)}` : ''}
                </span>
              </div>

              <div className="dev-sim-rows">
                <div className="dev-sim-row">
                  <span className="dev-sim-tag">SIM1</span>
                  {(device.sim1?.present || device.sim1?.number || device.sim1?.operator || device.sim1?.iccid) ? (
                    <>
                      <span className="num">{device.sim1.number || '未设置号码'}</span>
                      <span className="meta">{device.sim1.operator || '-'}{device.sim1.signal ? ` · ${device.sim1.signal}dBm` : ''}{device.sim1.registered ? ' · 已注册' : ' · 未注册'}</span>
                    </>
                  ) : (
                    <span className="meta">无卡</span>
                  )}
                </div>
                <div className="dev-sim-row">
                  <span className="dev-sim-tag">SIM2</span>
                  {(device.sim2?.present || device.sim2?.number || device.sim2?.operator || device.sim2?.iccid) ? (
                    <>
                      <span className="num">{device.sim2.number || '未设置号码'}</span>
                      <span className="meta">{device.sim2.operator || '-'}{device.sim2.signal ? ` · ${device.sim2.signal}dBm` : ''}{device.sim2.registered ? ' · 已注册' : ' · 未注册'}</span>
                    </>
                  ) : (
                    <span className="meta">无卡</span>
                  )}
                </div>
              </div>

              <div className="dev-meta-row">
                <span>IP <b className="mono">{device.ip}</b></span>
                <span>固件 <b>{device.version || String(otaResults[device.id]?.data?.version ?? '-')}</b></span>
                <span>分组 <b>{device.group || 'auto'}</b></span>
              </div>

              <div className="dev-actions">
                <button className="btn-action" onClick={() => refresh(device)} disabled={busyId === device.id}>🔄 刷新</button>
                <button className="btn-action" onClick={() => openTakeover(device)}>⚙️ 配置</button>
                <button className="btn-action" onClick={() => setSmsDevice(device)}>💬 短信</button>
                <button className="btn-action" onClick={() => void upgradeDevice(device)} disabled={!online || busyId === device.id} title={online ? '检查并升级设备固件' : '设备离线，无法升级'}>
                  <DownloadCloud size={13} /> OTA
                </button>
                <button className="btn-action" onClick={() => runAction(device, () => rebootManagedDevice(device.id), '重启失败')} disabled={busyId === device.id}>⚡ 重启</button>
                <button className="btn-action" onClick={() => window.open(`http://${device.ip}`, '_blank')}>🖥️ 后台</button>
                <button className="btn-action btn-danger" onClick={() => remove(device)} disabled={busyId === device.id}>🗑️</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="batch-bar" id="batch-bar" style={{display: 'none'}}>
        <span id="batch-count">0</span> 台已选
        <button className="btn-action" onClick={batchReboot}>⚡ 批量重启</button>
        <button className="btn-action btn-danger" onClick={batchRemove}>🗑️ 批量删除</button>
      </div>

      {/* FAB 添加设备 */}
      <button className="fab" onClick={() => setAddOpen(true)}>
        <Plus size={22} />
        添加
      </button>

      {/* Add Device Modal */}
      {addOpen && (
        <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>添加短信转发设备</h2>
              <button onClick={() => setAddOpen(false)}>✕</button>
            </div>
            <label className="field">
              <span>设备 IP 地址</span>
              <input value={addIp} onChange={(e) => setAddIp(e.target.value)} placeholder="例如 192.168.1.101" autoFocus />
            </label>
            <div className="modal-actions">
              <button
                className="btn-primary"
                disabled={loading || !addIp.trim()}
                onClick={async () => {
                  const ip = addIp.trim();
                  if (!ip) return;
                  setLoading(true);
                  setError('');
                  setNotice('');
                  try {
                    await addDevice({ip});
                    await load();
                    setNotice(`设备 ${ip} 已添加`);
                    setAddOpen(false);
                    setAddIp('');
                  } catch (err) {
                    setError(err instanceof Error ? err.message : '添加失败');
                  } finally {
                    setLoading(false);
                  }
                }}
              >确认添加</button>
            </div>
          </div>
        </div>
      )}

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
                <div><span>WiFi</span><strong>{takeover?.status.wifi?.ssid || takeoverDevice.wifi.name || '-'}</strong></div>
                <div><span>信号</span><strong>{String(takeover?.status.modem?.signal_dbm || takeoverDevice.sim1.signal || '-')} dBm</strong></div>
              </div>

              <div className="takeover-nav">
                {([['basic', '📱 基础'], ['forward', '📤 转发'], ['network', '🌐 网络服务'], ['maint', '⚙️ 维护']] as Array<[string, string]>).map(([key, label]) => (
                  <button key={key} className={takeoverPane === key ? 'active' : ''} onClick={() => setTakeoverPane(key)}>{label}</button>
                ))}
              </div>

              {takeover?.statusError && <div className="error inline-error">{takeover.statusError}</div>}
              {!configReady && <div className="error inline-error">{takeover?.configError || '设备当前配置未读取成功，已禁用保存固件配置。AT、OTA、重启等操作仍可尝试使用。'}</div>}

              <div className="save-config-bar">
                <button className="btn-primary" onClick={saveConfig} disabled={!configReady}>💾 保存固件配置</button>
                <button className="btn-secondary" onClick={() => { setCopyTargets(new Set()); setCopyDialogOpen(true); }} disabled={!configReady}>📋 复制配置到其他设备</button>
              </div>

              <div className="takeover-grid" data-pane={takeoverPane}>
                <section className="takeover-card accent-blue" data-pane="basic">
                  <h3>📱 设备身份</h3>
                  <label>设备名称<input value={config.deviceName || ''} onChange={(e) => patchConfig({deviceName: e.target.value})} /></label>
                  <label>Web 用户<input value={config.webUser || ''} onChange={(e) => patchConfig({webUser: e.target.value})} /></label>
                  <label>Web 密码<input type="password" value={config.webPass || ''} onChange={(e) => patchConfig({webPass: e.target.value})} /></label>
                </section>

                <section className="takeover-card accent-green" data-pane="basic">
                  <h3>📶 WiFi 热点接管</h3>
                  <label>热点名称<input value={wifiSsid} onChange={(e) => setWifiSsid(e.target.value)} placeholder="路由器 SSID" /></label>
                  <label>热点密码<div className="password-input-row"><input type={showWifiPassword ? 'text' : 'password'} value={wifiPassword} onChange={(e) => setWifiPassword(e.target.value)} placeholder="当前热点未设置密码" /><button type="button" className="btn-secondary" onClick={() => setShowWifiPassword((current) => !current)}>{showWifiPassword ? '隐藏' : '查看'}</button></div></label>
                  <button className="btn-secondary" onClick={saveWifi} disabled={!wifiSsid.trim() || busyId === takeoverDevice.id}>保存 WiFi 并重连</button>
                </section>

                <section className="takeover-card accent-amber" data-pane="basic">
                  <h3> SIM 与网络</h3>
                  <label>SIM1 号码<input value={String(takeover?.status.modem?.sim1_number || takeoverDevice.sim1.number || '')} onChange={() => undefined} onBlur={(e) => saveSimNumber(1, e.currentTarget.value)} /></label>
                  {String((takeover?.status.modem as Record<string, unknown> | undefined)?.sim1_imsi || '') && (
                    <label style={{fontSize: 12, color: '#94a3b8'}}>SIM1 IMSI：{String((takeover?.status.modem as Record<string, unknown>).sim1_imsi)}</label>
                  )}
                  <label>SIM1 PIN 码<input type="password" value={config.sim1Pin || ''} onChange={(e) => patchConfig({sim1Pin: e.target.value})} placeholder={config.sim1PinSet ? '已设置，留空不修改' : '未设置'} /></label>
                  <label>SIM2 号码<input value={String(takeover?.status.modem?.sim2_number || takeoverDevice.sim2.number || '')} onChange={() => undefined} onBlur={(e) => saveSimNumber(2, e.currentTarget.value)} /></label>
                  {String((takeover?.status.modem as Record<string, unknown> | undefined)?.sim2_imsi || '') && (
                    <label style={{fontSize: 12, color: '#94a3b8'}}>SIM2 IMSI：{String((takeover?.status.modem as Record<string, unknown>).sim2_imsi)}</label>
                  )}
                  <label>网络模式<select value={config.networkMode || 0} onChange={(e) => patchConfig({networkMode: Number(e.target.value)})}><option value={0}>自动</option><option value={1}>WiFi only</option><option value={2}>4G only</option></select></label>
                </section>

                <section className="takeover-card" data-pane="forward">
                  <h3>📞 通话/录音</h3>
                  <label>录音<select value={config.callRecordEnabled ? 1 : 0} onChange={(e) => patchConfig({callRecordEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>SIM1 自动接听<select value={config.sim1CallAutoAnswer ? 1 : 0} onChange={(e) => { const enabled = e.target.value === '1'; patchConfig({sim1CallAutoAnswer: enabled, callRecordAutoAnswer: enabled || Boolean(config.sim2CallAutoAnswer)}); }}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>SIM2 自动接听<select value={config.sim2CallAutoAnswer ? 1 : 0} onChange={(e) => { const enabled = e.target.value === '1'; patchConfig({sim2CallAutoAnswer: enabled, callRecordAutoAnswer: enabled || Boolean(config.sim1CallAutoAnswer)}); }}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>挂断秒数<input type="number" value={config.callHangupSeconds || 10} onChange={(e) => patchConfig({callHangupSeconds: Number(e.target.value)})} /></label>
                  <label>TTS 播报<select value={config.callPlayEnabled ? 1 : 0} onChange={(e) => patchConfig({callPlayEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>TTS 内容<input value={config.callPlayFile || ''} onChange={(e) => patchConfig({callPlayFile: e.target.value})} placeholder="播报内容" /></label>
                </section>

                <section className="takeover-card wide accent-amber" data-pane="forward">
                  <h3>📣 通知模板与短信白名单</h3>
                  <div className="takeover-two">
                    <label>开机通知<select value={config.bootNotifyEnabled ?? true ? 1 : 0} onChange={(e) => patchConfig({bootNotifyEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>短信白名单<select value={config.smsWhitelistEnabled ? 1 : 0} onChange={(e) => patchConfig({smsWhitelistEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  </div>
                  <label>开机通知模板<input value={config.bootNotifyTemplate || ''} onChange={(e) => patchConfig({bootNotifyTemplate: e.target.value})} placeholder="设备开机推送到各通道的内容模板" /></label>
                  <label>来电通知模板<input value={config.callNotifyTemplate || ''} onChange={(e) => patchConfig({callNotifyTemplate: e.target.value})} placeholder="来电推送内容模板" /></label>
                  <label>白名单关键词<input value={config.smsWhitelistKeywords || ''} onChange={(e) => patchConfig({smsWhitelistKeywords: e.target.value})} placeholder="逗号分隔，短信命中任一关键词才推送" /></label>
                  <label style={{fontSize: 12, color: '#94a3b8'}}>白名单仅对短信推送生效（固件 V4.7+）；开启后未命中关键词的短信只入消息中心、不推送。</label>
                </section>

                <section className="takeover-card wide" data-pane="forward">
                  <h3>📤 转发通道</h3>
                  <div className="channel-tabs">
                    {[0, 1, 2, 3, 4].map((i) => <button key={i} className={activeChannel === i ? 'active' : ''} onClick={() => setActiveChannel(i)}>通道 {i + 1}</button>)}
                  </div>
                  <label>类型<select value={config.pushChannels?.[activeChannel]?.type || 0} onChange={(e) => patchChannel({type: Number(e.target.value)})}>{channelTypes.map((name, i) => <option key={name} value={i}>{name}</option>)}</select></label>
                  {chanMeta && (
                    <label>{chanMeta.urlLabel}<textarea value={config.pushChannels?.[activeChannel]?.url || ''} onChange={(e) => patchChannel({url: e.target.value})} placeholder={chanMeta.urlPh} /></label>
                  )}
                  {chanMeta?.k1 && (
                    <label>{chanMeta.k1[0]}<input value={config.pushChannels?.[activeChannel]?.key1 || ''} onChange={(e) => patchChannel({key1: e.target.value})} placeholder={chanMeta.k1[1]} /></label>
                  )}
                  {chanMeta?.k2 && (
                    <label>{chanMeta.k2[0]}<input value={config.pushChannels?.[activeChannel]?.key2 || ''} onChange={(e) => patchChannel({key2: e.target.value})} placeholder={chanMeta.k2[1]} /></label>
                  )}
                  <label>模板<textarea value={config.pushChannels?.[activeChannel]?.customBody || ''} onChange={(e) => patchChannel({customBody: e.target.value})} /></label>
                  <div className="takeover-two">
                    <label>SIM1 推送<select value={config.pushChannels?.[activeChannel]?.sim1Enabled ?? true ? 1 : 0} onChange={(e) => patchChannel({sim1Enabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>SIM2 推送<select value={config.pushChannels?.[activeChannel]?.sim2Enabled ?? true ? 1 : 0} onChange={(e) => patchChannel({sim2Enabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  </div>
                  <label style={{fontSize: 12, color: '#94a3b8'}}>卡绑定：关闭后该通道不转发对应 SIM 卡的短信/来电（固件 V4.7+）。</label>
                  <label>录音上传<select value={config.pushChannels?.[activeChannel]?.recordUploadEnabled ? 1 : 0} onChange={(e) => patchChannel({recordUploadEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                  <label>录音上传 URL<input value={config.pushChannels?.[activeChannel]?.recordUrl || ''} onChange={(e) => patchChannel({recordUrl: e.target.value})} placeholder="录音文件上传地址" /></label>
                  <div className="serial-command refined">
                    <button className="btn-primary" onClick={runPushTest} disabled={pushBusy || busyId === takeoverDevice.id}>{pushBusy ? '发送中…' : '发送测试推送'}</button>
                    <span className="text-muted">推送至当前通道 {activeChannel + 1}</span>
                  </div>
                  {pushResult && <div className={`inline-error ${pushResult.includes('失败') ? 'error' : 'success'}`}>{pushResult}</div>}
                </section>

                <section className="takeover-card wide" data-pane="network">
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

                <section className="takeover-card wide" data-pane="maint">
                  <h3>⚙️ 系统与维护</h3>
                  <div className="takeover-two">
                    <label>定时重启<select value={config.rebootEnabled ? 1 : 0} onChange={(e) => patchConfig({rebootEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>重启时间<div style={{display: 'flex', gap: 4, alignItems: 'center'}}><input type="number" value={config.rebootHour ?? 4} onChange={(e) => patchConfig({rebootHour: Number(e.target.value)})} min={0} max={23} style={{width: 50}} /><span>:</span><input type="number" value={config.rebootMinute ?? 0} onChange={(e) => patchConfig({rebootMinute: Number(e.target.value)})} min={0} max={59} style={{width: 50}} /></div></label>
                  </div>
                  <div className="takeover-two">
                    <label>短信控制<select value={config.smsControlEnabled ? 1 : 0} onChange={(e) => patchConfig({smsControlEnabled: e.target.value === '1'})}><option value={0}>关闭</option><option value={1}>开启</option></select></label>
                    <label>管理员号码<input value={config.adminPhones || ''} onChange={(e) => patchConfig({adminPhones: e.target.value})} placeholder="逗号分隔" /></label>
                  </div>
                  <label>Web 端口<input type="number" value={config.webPort ?? 80} onChange={(e) => patchConfig({webPort: Number(e.target.value)})} min={1} max={65535} placeholder="80" /></label>
                  <label>本地固件上传<div className="serial-command refined"><input type="file" accept=".bin" onChange={(e) => setOtaFile(e.target.files?.[0] || null)} /><button className="btn-secondary" onClick={runOtaUpload} disabled={!otaFile || otaUploadBusy || busyId === takeoverDevice.id}>{otaUploadBusy ? '上传中…' : '上传并刷写'}</button></div></label>
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

                <section className="takeover-card accent-red" data-pane="maint">
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
              </div>
              <div className="save-config-bar">
                <button className="btn-primary" onClick={saveConfig} disabled={!configReady}>💾 保存固件配置</button>
                <button className="btn-secondary" onClick={() => { setCopyTargets(new Set()); setCopyDialogOpen(true); }} disabled={!configReady}>📋 复制配置到其他设备</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Copy Config Dialog */}
      {copyDialogOpen && (
        <div className="modal-backdrop" onClick={() => setCopyDialogOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>复制配置到其他设备</h2>
              <button onClick={() => setCopyDialogOpen(false)}>✕</button>
            </div>
            <div className="copy-config-info">
              <p>将当前设备配置（不含设备名称）复制到选中的设备：</p>
              <ul>
                <li>WiFi 设置、SIM 号码/PIN、网络模式</li>
                <li>通话录音、TTS 播报</li>
                <li>转发通道（5 个）</li>
                <li>MQTT 上报配置</li>
                <li>系统维护设置</li>
              </ul>
              <p style={{color: 'var(--amber)', fontWeight: 600}}>⚠️ 设备名称不会被复制，每台设备保留自己的名称</p>
            </div>
            <div className="copy-device-list">
              {items.filter(d => d.id !== takeoverDevice?.id).map((device) => (
                <label key={device.id} className="copy-device-item">
                  <input
                    type="checkbox"
                    checked={copyTargets.has(device.id)}
                    onChange={(e) => {
                      const next = new Set(copyTargets);
                      if (e.target.checked) next.add(device.id);
                      else next.delete(device.id);
                      setCopyTargets(next);
                    }}
                  />
                  <span className="copy-device-name">{device.name || device.ip}</span>
                  <span className={`copy-device-status ${device.status === 'online' ? 'online' : 'offline'}`}>
                    {device.status === 'online' ? '在线' : '离线'}
                  </span>
                </label>
              ))}
              {items.filter(d => d.id !== takeoverDevice?.id).length === 0 && (
                <div className="empty">没有其他可复制的设备</div>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setCopyDialogOpen(false)}>取消</button>
              <button
                className="btn-primary"
                onClick={copyConfigToDevices}
                disabled={copyBusy || copyTargets.size === 0}
              >
                {copyBusy ? '复制中...' : `确认复制 (${copyTargets.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scan Dialog */}
      {scanOpen && (
        <div className="modal-backdrop" onClick={() => !scanRunning && setScanOpen(false)}>
          <div className="modal-panel modal-large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>🔍 扫描局域网设备</h2>
              <button onClick={() => !scanRunning && setScanOpen(false)}>✕</button>
            </div>
            <div className="scan-config">
              <div className="scan-config-row">
                <label>网段 CIDR<input value={scanCidr} onChange={(e) => setScanCidr(e.target.value)} placeholder="例如 192.168.1.0/24，留空自动检测" disabled={scanRunning} /></label>
              </div>
              <div className="scan-config-row">
                <label>起始 IP<input value={scanStartIp} onChange={(e) => setScanStartIp(e.target.value)} placeholder="例如 192.168.1.1" disabled={scanRunning} /></label>
                <label>结束 IP<input value={scanEndIp} onChange={(e) => setScanEndIp(e.target.value)} placeholder="例如 192.168.1.254" disabled={scanRunning} /></label>
              </div>
              <div className="scan-config-row">
                <label>设备用户名<input value={scanUser} onChange={(e) => setScanUser(e.target.value)} disabled={scanRunning} /></label>
                <label>设备密码<input type="password" value={scanPassword} onChange={(e) => setScanPassword(e.target.value)} disabled={scanRunning} /></label>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => !scanRunning && setScanOpen(false)}>取消</button>
              <button className="btn-primary" onClick={runScan} disabled={scanRunning}>
                {scanRunning ? '扫描中...' : '开始扫描'}
              </button>
            </div>
            {scanProgress && <div className="scan-progress">{scanProgress}</div>}
            {scanStatus && scanStatus.results.length > 0 && (
              <div className="scan-results">
                <h3>发现设备 ({scanStatus.found})</h3>
                {scanStatus.results.filter(r => r.httpOpen).map((result) => (
                  <div key={result.ip} className="scan-result-item">
                    <span className="scan-result-ip">{result.ip}</span>
                    {result.success ? (
                      <span className="scan-result-status success">✓ 已添加</span>
                    ) : (
                      <button className="btn-action" onClick={() => claimScannedDevice(result.ip)} disabled={scanRunning}>添加</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
