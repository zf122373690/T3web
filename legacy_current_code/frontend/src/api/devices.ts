import apiClient from './client';

export interface ManagedDevice {
  id: number;
  devId?: string;
  alias?: string;
  grp?: string;
  ip: string;
  mac?: string;
  status?: string;
  lastSeen?: number;
  firmwareVersion?: string;
  sims?: {
    sim1?: { number?: string; operator?: string; signal?: number; label?: string };
    sim2?: { number?: string; operator?: string; signal?: number; label?: string };
  };
}

export interface ScanStatus {
  id: string;
  cidr: string;
  total: number;
  found: number;
  failed: number;
  pending: number;
  elapsed: number;
  results: Array<{ ip: string; success: boolean; data?: Record<string, unknown> }>;
}

export interface ScanResult {
  total: number;
  found: number;
  saved: number;
  devices: ManagedDevice[];
}

export function listDevices() {
  return apiClient.get<ManagedDevice[]>('/devices');
}

export function addDevice(payload: { ip: string; mac?: string; user?: string; password?: string; group?: string }) {
  return apiClient.post<ManagedDevice>('/devices', payload);
}

export function deleteDevice(deviceId: number) {
  return apiClient.delete<{ success: boolean }>(`/devices/${deviceId}`);
}

export function refreshDevice(deviceId: number) {
  return apiClient.post<ManagedDevice>(`/devices/${deviceId}/refresh`, {});
}

export function startScan(payload: { cidr?: string; user?: string; password?: string }) {
  return apiClient.post<{ scanId: string; cidr: string; total: number }>('/scan', payload);
}

export function getScanStatus(scanId: string) {
  return apiClient.get<ScanStatus>(`/scan/${scanId}`);
}

export function saveScanResults(scanId: string, payload: { user?: string; password?: string }) {
  return apiClient.post<ScanResult>(`/scan/${scanId}/results`, payload);
}
