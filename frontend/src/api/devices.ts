import {api} from './client';

export interface DeviceItem {
  id: number;
  ip: string;
  mac: string;
  name: string;
  group: string;
  status: string;
  lastSeen: number;
  version: string;
  sim1: {number: string; operator: string; signal: string};
  sim2: {number: string; operator: string; signal: string};
  wifi: {name: string; dbm: string};
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

export function startScan(payload: {cidr?: string; user?: string; password?: string}) {
  return api.post<{scanId: string; cidr: string; total: number; autoDetected: boolean}>('/scan', payload);
}

export function getScanStatus(scanId: string) {
  return api.get<ScanStatus>(`/scan/${scanId}`);
}
