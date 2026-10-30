import {api} from './client';

export interface SelfUpdateState {
  status: string;
  message: string;
  localVersion: string;
  remoteVersion: string;
  hasUpdate: boolean;
  packageName: string;
  packagePath: string;
  packageSize: number;
  packageModified: string;
  packageNotes: string;
  packageSource: string;
  packageSignature: string;
  downloadUrl: string;
  downloadedPath: string;
  progress: number;
  checkedAt: number;
  error: string;
  restartRequired: boolean;
  cloudBase: string;
  cloudDir: string;
  appliedSignature: string;
  isFrozen?: boolean;
  exePath?: string;
}

export interface SystemVersionInfo {
  localVersion: string;
  otaServerVersion: string;
  otaServerAvailable: boolean;
  otaServerMessage: string;
  cloudBase?: string;
  cloudDir?: string;
  selfUpdate?: SelfUpdateState;
}

export function getSystemVersion() {
  return api.get<SystemVersionInfo>('/version');
}

export function getSelfUpdateStatus() {
  return api.get<SelfUpdateState>('/self-update/status');
}

export function checkSelfUpdate() {
  return api.post<SelfUpdateState>('/self-update/check');
}

export function downloadSelfUpdate(force = false) {
  return api.post<SelfUpdateState>('/self-update/download', {force});
}

export function applySelfUpdate(restart = true) {
  return api.post<SelfUpdateState>('/self-update/apply', {restart});
}

export function runSelfUpdate(force = false, restart = true) {
  return api.post<SelfUpdateState>('/self-update/run', {force, restart});
}

export interface LanCidrInfo {
  cidr: string;
  prefix: string;
  network: string;
}

export function detectLanCidr() {
  return api.get<LanCidrInfo>('/lan-cidr');
}

export interface FirmwareOtaResult {
  id: number;
  ip: string;
  success: boolean;
  message: string;
  endpoint?: string;
  data?: Record<string, unknown>;
}

export interface DeviceItem {
  id: number;
  ip: string;
  mac: string;
  name: string;
  group: string;
  status: string;
  lastSeen: number;
  version: string;
  sim1: {number: string; operator: string; signal: string; iccid?: string; imsi?: string; registered?: boolean; present?: boolean};
  sim2: {number: string; operator: string; signal: string; iccid?: string; imsi?: string; registered?: boolean; present?: boolean};
  wifi: {name: string; dbm: string; ip?: string; connected?: boolean};
}

export interface T3PushChannel {
  enabled?: boolean;
  type?: number;
  name?: string;
  url?: string;
  key1?: string;
  key2?: string;
  customBody?: string;
  recordUploadEnabled?: boolean;
  recordUrl?: string;
  sim1Enabled?: boolean;
  sim2Enabled?: boolean;
}

export interface T3MqttConfig {
  enabled?: boolean;
  broker?: string;
  server?: string;
  host?: string;
  port?: number;
  topicPrefix?: string;
  topic?: string;
  username?: string;
  user?: string;
  password?: string;
  pass?: string;
  clientId?: string;
  keepAlive?: number;
  statusInterval?: number;
}

export interface T3Config {
  deviceName?: string;
  smtpServer?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSendTo?: string;
  callRecordEnabled?: boolean;
  callRecordAutoAnswer?: boolean;
  sim1CallAutoAnswer?: boolean;
  sim2CallAutoAnswer?: boolean;
  callHangupSeconds?: number;
  callPlayEnabled?: boolean;
  callPlayFile?: string;
  recordUploadType?: number;
  recordUploadUrl?: string;
  recordUploadKey1?: string;
  recordUploadKey2?: string;
  mqttEnabled?: boolean;
  mqttServer?: string;
  mqttPort?: number;
  mqttTopic?: string;
  mqttUser?: string;
  mqttPass?: string;
  mqttClientId?: string;
  mqtt?: T3MqttConfig;
  wifi?: {configured?: boolean; ssid?: string; password?: string};
  networkMode?: number;
  bootNotifyEnabled?: boolean;
  bootNotifyTemplate?: string;
  callNotifyTemplate?: string;
  webUser?: string;
  webPass?: string;
  sim1Remark?: string;
  sim2Remark?: string;
  sim1Pin?: string;
  sim2Pin?: string;
  sim1PinSet?: boolean;
  sim2PinSet?: boolean;
  pushChannels?: T3PushChannel[];
  rebootEnabled?: boolean;
  rebootHour?: number;
  rebootMinute?: number;
  smsControlEnabled?: boolean;
  adminPhones?: string;
  smsWhitelistEnabled?: boolean;
  smsWhitelistKeywords?: string;
  smsCleanEnabled?: boolean;
  smsCleanCheckInterval?: number;
  smsCleanThreshold?: number;
  smsCleanKeepCount?: number;
  ddnsEnabled?: boolean;
  ddnsApiToken?: string;
  ddnsSubDomain?: string;
  ddnsInterval?: number;
  webPort?: number;
}

export interface T3Status {
  uptime?: number;
  freeHeap?: number;
  mac?: string;
  version?: string;
  deviceName?: string;
  wifi?: {connected?: boolean; ip?: string; rssi?: number; ssid?: string};
  modem?: Record<string, string | number | boolean>;
}

export interface T3Takeover {
  success: boolean;
  device?: DeviceItem;
  status: T3Status;
  config: T3Config;
  statusReady?: boolean;
  configReady?: boolean;
  statusError?: string;
  configError?: string;
  statusEndpoint?: string;
  configEndpoint?: string;
}

export function listDevices() {
  return api.get<{items: DeviceItem[]; total: number}>('/devices');
}

export function refreshAllDevices() {
  return api.post<{items: DeviceItem[]; total: number}>('/devices/refresh-all');
}

export function addDevice(payload: {ip: string; user?: string; password?: string}) {
  return api.post<DeviceItem>('/devices', payload);
}

export function refreshDevice(id: number) {
  return api.post<DeviceItem>(`/devices/${id}/refresh`);
}

export function deleteDevice(id: number) {
  return api.delete<{success: boolean}>(`/devices/${id}`);
}

export function bulkDeleteDevices(ids: number[]) {
  return api.post<{success: boolean; deleted: number}>('/devices/bulk-delete', {ids});
}

export function sendDeviceSms(id: number, payload: {phone: string; content: string; simSlot: number}) {
  return api.post<{success: boolean; message: string}>(`/devices/${id}/sms`, payload);
}

export function setDeviceFlymode(id: number, enabled: boolean) {
  return api.post<{success: boolean; message: string; endpoint?: string}>(`/devices/${id}/flymode`, {enabled});
}

export function rebootManagedDevice(id: number) {
  return api.post<{success: boolean; message: string; endpoint?: string}>(`/devices/${id}/reboot`);
}

export function getDeviceTakeover(id: number) {
  return api.get<T3Takeover>(`/devices/${id}/takeover`);
}

export function updateDeviceConfig(id: number, payload: T3Config) {
  return api.post<{success: boolean; message: string; endpoint?: string; status?: T3Status}>(`/devices/${id}/config`, payload);
}

export function updateDeviceWifi(id: number, payload: {ssid: string; password?: string}) {
  return api.post<{success: boolean; message: string; endpoint?: string}>(`/devices/${id}/wifi`, payload);
}

export function updateDeviceSimNumber(id: number, payload: {slot: number; number: string}) {
  return api.post<{success: boolean; message: string; endpoint?: string; data?: unknown; device?: DeviceItem}>(`/devices/${id}/sim-number`, payload);
}

export function factoryResetDevice(id: number) {
  return api.post<{success: boolean; message: string; endpoint?: string}>(`/devices/${id}/factory-reset`);
}

export function clearDeviceMessages(id: number) {
  return api.post<{success: boolean; message: string; endpoint?: string}>(`/devices/${id}/clear-messages`);
}

export function checkDeviceOta(id: number) {
  return api.get<{success: boolean; message: string; endpoint?: string; data: {update?: boolean; version?: string; url?: string; error?: string}}>(`/devices/${id}/ota`);
}

export function checkDeviceFirmwareVersion(id: number) {
  return api.get<{success: boolean; message: string; endpoint?: string; data?: Record<string, unknown>}>(`/devices/${id}/ota/version`);
}

export function batchCheckDeviceOta(ids: number[]) {
  return api.post<{success: boolean; items: FirmwareOtaResult[]; total: number}>(`/devices/ota/batch-check`, {ids});
}

export function batchStartDeviceOta(ids: number[], url: string, user?: string, password?: string) {
  return api.post<{success: boolean; items: FirmwareOtaResult[]; total: number}>(`/devices/ota/batch-upgrade`, {ids, url, user, password});
}

export function startDeviceOta(id: number, url: string) {
  return api.post<{success: boolean; message: string; endpoint?: string; data?: unknown}>(`/devices/${id}/ota`, {url});
}

export function pushTestDevice(id: number, channel?: number) {
  return api.post<{success: boolean; message: string; endpoint?: string; data?: Record<string, unknown>}>(`/devices/${id}/push-test`, channel === undefined ? {} : {channel});
}

export function getDeviceDdns(id: number) {
  return api.get<{success: boolean; message: string; endpoint?: string; data: Record<string, string | number | boolean>}>(`/devices/${id}/ddns`);
}

export function updateDeviceDdns(id: number) {
  return api.post<{success: boolean; message: string; endpoint?: string; data?: Record<string, unknown>}>(`/devices/${id}/ddns/update`);
}

export function getDeviceOtaProgress(id: number) {
  return api.get<{success: boolean; message: string; endpoint?: string; data: {running?: boolean; finished?: boolean; success?: boolean; loaded?: number; total?: number; percent?: number; message?: string}}>(`/devices/${id}/ota/progress`);
}

export interface DeviceMessageItem {
  type?: string;
  ts?: string;
  sim?: string;
  num?: string;
  from?: string;
  msg?: string;
}

export function getDeviceMessages(id: number, type = 'all') {
  return api.get<{success: boolean; message: string; endpoint?: string; data: DeviceMessageItem[]}>(`/devices/${id}/messages?type=${encodeURIComponent(type)}`);
}


export function getPendingDeviceMessages(id: number) {
  return api.get<{success: boolean; message: string; data: DeviceMessageItem[]}>(`/devices/${id}/messages/pending`);
}

export function purgeDeviceSms(id: number, keepCount?: number) {
  return api.post<{success: boolean; message: string; data?: Record<string, unknown>}>(`/devices/${id}/sms/purge`, keepCount === undefined ? {} : {keepCount});
}

export interface EsimProfile {
  iccid?: string;
  aid?: string;
  nickname?: string;
  serviceProviderName?: string;
  profileName?: string;
  state?: string;
  profileClass?: string;
}

export interface EsimStatus {
  running?: boolean;
  done?: boolean;
  success?: boolean;
  slot?: number;
  action?: string;
  message?: string;
  refreshRequired?: boolean;
  supported?: boolean;
  eid?: string;
  profiles?: EsimProfile[];
}

export function queryDeviceEsim(id: number, slot: number, start: boolean) {
  return api.get<{success: boolean; message: string; data: EsimStatus}>(`/devices/${id}/esim?slot=${slot}&start=${start ? 1 : 0}`);
}

export function operateDeviceEsimProfile(id: number, payload: {slot: number; action: 'enable' | 'disable' | 'delete'; identifier: string}) {
  return api.post<{success: boolean; message: string}>(`/devices/${id}/esim/profile`, payload);
}

export function selectDeviceOperator(id: number, payload: {slot: number; plmn?: string}) {
  return api.post<{success: boolean; message: string}>(`/devices/${id}/operator/select`, payload);
}

export function startDeviceKeepaliveTest(id: number, payload: {slot: number; mode: 'sms' | 'call'; phone?: string; message?: string}) {
  return api.post<{success: boolean; message: string}>(`/devices/${id}/keepalive-test`, payload);
}

export function getDeviceKeepaliveTestStatus(id: number) {
  return api.get<{success: boolean; message: string; data: {state?: string; running?: boolean; success?: boolean; message?: string}}>(`/devices/${id}/keepalive-test/status`);
}

export function locateDevice(id: number) {
  return api.post<{success: boolean; message: string}>(`/devices/${id}/locate`);
}

export function uploadDeviceOta(id: number, file: File) {
  const form = new FormData();
  form.append('file', file);
  return api.upload<{success: boolean; message: string}>(`/devices/${id}/ota/upload`, form);
}
