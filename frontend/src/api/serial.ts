import {api} from './client';

export interface SerialPortItem {
  name: string;
  description: string;
  hwid: string;
}

export interface SerialSessionStatus {
  port: string;
  connected: boolean;
  baudrate: number;
  logCount: number;
  lastReadAt: number;
  readerAlive: boolean;
  lastError: string;
}

export interface SerialStatus {
  available: boolean;
  connected: boolean;
  port: string;
  baudrate: number;
  lastError: string;
  lastReadAt: number;
  logCount: number;
  safeMode: boolean;
  cdcMode: boolean;
  dtrEnabled: boolean;
  rtsEnabled: boolean;
  lineState: {cts: boolean; dsr: boolean; cd: boolean};
  bytesReceived: number;
  readIterations: number;
  readerAlive: boolean;
  lastRawHex: string;
  serialConfig: string;
  sessions?: SerialSessionStatus[];
  activePort?: string;
}

export interface SerialLogItem {
  id?: number;
  time: number;
  level: 'rx' | 'tx' | 'system' | 'error';
  content: string;
}

export function listSerialPorts() {
  return api.get<{items: SerialPortItem[]; available: boolean}>('/serial/ports');
}

export function getSerialStatus(port = '') {
  const query = port ? `?port=${encodeURIComponent(port)}` : '';
  return api.get<SerialStatus>(`/serial/status${query}`);
}

export function getSerialLogs(limit = 200, after = 0, port = '') {
  const params = new URLSearchParams({limit: String(limit), after: String(after)});
  if (port) params.set('port', port);
  return api.get<{items: SerialLogItem[]; latestId?: number}>(`/serial/logs?${params.toString()}`);
}

export function connectSerial(payload: {port: string; baudrate: number; safeMode?: boolean; cdcMode?: boolean; dtr?: boolean; rts?: boolean}) {
  return api.post<{success: boolean; message: string}>('/serial/connect', payload);
}

export function setSerialControlLines(payload: {dtr: boolean; rts: boolean; port?: string}) {
  return api.post<{success: boolean; message: string; lineState?: SerialStatus['lineState']}>('/serial/control-lines', payload);
}

export function probeSerial(duration = 3, port = '') {
  return api.post<{success: boolean; message: string; bytesReceived: number; samples: unknown[]}>('/serial/probe', {duration, port});
}

export function disconnectSerial(port = '') {
  const query = port ? `?port=${encodeURIComponent(port)}` : '';
  return api.post<{success: boolean; message: string}>(`/serial/disconnect${query}`);
}

export function sendSerialCommand(command: string, port = '') {
  return api.post<{success: boolean; message: string}>('/serial/send', {command, port});
}

export interface SerialOfflineChannel {
  enabled?: boolean;
  type?: number;
  url?: string;
  key1?: string;
  key2?: string;
  customBody?: string;
}

export interface SerialBatchConfigResult {
  success: boolean;
  message: string;
  items: Array<{port: string; success: boolean; message: string}>;
  total: number;
  succeeded: number;
  failed: number;
}

export function sendSerialOfflineConfig(payload: {port?: string; deviceName?: string; wifiSsid?: string; wifiPassword?: string; networkMode?: number; pushChannels?: SerialOfflineChannel[]; sim1Pin?: string; sim2Pin?: string}) {
  return api.post<{success: boolean; message: string; payload: string; configResponse?: string[]}>('/serial/offline-config', payload);
}

export function sendSerialBatchOfflineConfig(payload: {ports: string[]; deviceName?: string; wifiSsid: string; wifiPassword?: string; pushChannels?: SerialOfflineChannel[]; sim1Pin?: string; sim2Pin?: string}) {
  return api.post<SerialBatchConfigResult>('/serial/offline-config/batch', payload);
}

export interface SerialBatchActionResult {
  success: boolean;
  message: string;
  items: Array<{port: string; success: boolean; message: string; version?: string}>;
  total: number;
  succeeded: number;
  failed: number;
}

export function saveSerialWifiBatch(payload: {ports: string[]; wifiSsid: string; wifiPassword?: string}) {
  return api.post<SerialBatchActionResult>('/serial/wifi/batch', payload);
}

export function checkSerialVersions(payload: {ports: string[]}) {
  return api.post<SerialBatchActionResult>('/serial/version/batch', payload);
}

export function startSerialOta(payload: {ports: string[]; url: string}) {
  return api.post<SerialBatchActionResult>('/serial/ota/batch', payload);
}

export interface SerialDeviceConfig {
  deviceName?: string;
  wifi?: {configured?: boolean; ssid?: string; password?: string};
  networkMode?: number;
  pushChannels?: SerialOfflineChannel[];
  sim1Pin?: string;
  sim2Pin?: string;
  sim1PinSet?: boolean;
  sim2PinSet?: boolean;
  [key: string]: unknown;
}

export function readSerialDeviceConfig(port = '') {
  const query = port ? `?port=${encodeURIComponent(port)}` : '';
  return api.post<{success: boolean; message: string; config: SerialDeviceConfig; raw?: string[]}>(`/serial/read-config${query}`);
}

export function resetSerialDevice(port = '') {
  const query = port ? `?port=${encodeURIComponent(port)}` : '';
  return api.post<{success: boolean; message: string}>(`/serial/reset${query}`);
}

export function saveSerialDeviceProfile(payload: {ip: string; deviceName?: string; wifiSsid?: string; wifiPassword?: string}) {
  return api.post<{success: boolean; message: string; endpoints?: string[]}>('/serial/profile', payload);
}
