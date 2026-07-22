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
  sim1: {number: string; operator: string; signal: string; iccid?: string; registered?: boolean; present?: boolean};
  sim2: {number: string; operator: string; signal: string; iccid?: string; registered?: boolean; present?: boolean};
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

export interface ScanStatus {
  id: string;
  cidr: string;
  total: number;
  pending: number;
  found: number;
  failed: number;
  done: boolean;
  results: Array<{ip: string; success: boolean; candidate?: boolean; autoSaved?: boolean; httpOpen?: boolean; device?: DeviceItem; realm?: string}>;
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

export function sendDeviceAt(id: number, payload: {command: string; timeout?: number}) {
  return api.post<{success: boolean; message: string; endpoint?: string; data?: {response?: string}}>(`/devices/${id}/at`, payload);
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

export function startScan(payload: {cidr?: string; startIp?: number; endIp?: number; user?: string; password?: string}) {
  return api.post<{scanId: string; cidr: string; total: number; autoDetected: boolean}>('/scan', payload);
}

export function getScanStatus(scanId: string) {
  return api.get<ScanStatus>(`/scan/${scanId}`);
}
