import {api} from './client';

export interface MessageItem {
  id: number;
  phone: string;
  from: string;
  content: string;
  direction: string;
  status: string;
  createdAt: number;
  time: number;
  deviceId: string;
  deviceName: string;
  simSlot: string;
  simNumber: string;
}

export interface CallItem {
  id: number;
  phone: string;
  createdAt: number;
  duration?: number;
  deviceId: string;
  deviceName: string;
  simSlot: string;
  simNumber: string;
}

export interface MessageStats {
  total: number;
  today: number;
  week: number;
  failed: number;
}

export interface SyncDeviceRecordsResult {
  success: boolean;
  devices: number;
  syncedDevices: number;
  failedDevices: number;
  imported: number;
  skipped: number;
  message: string;
  errors: string[];
}

export function listMessages(params: {page?: number; pageSize?: number; search?: string; direction?: string} = {}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 50),
    search: params.search ?? '',
    direction: params.direction ?? '',
  });
  return api.get<{items: MessageItem[]; total: number; page: number; pageSize: number}>(`/messages?${query}`);
}

export function getMessageStats() {
  return api.get<MessageStats>('/messages/stats');
}

export function syncDeviceRecords() {
  return api.post<SyncDeviceRecordsResult>('/messages/sync');
}

export function deleteMessage(id: number) {
  return api.delete<{success: boolean}>(`/messages/${id}`);
}

export function clearMessages(direction = '') {
  const query = direction ? `?direction=${encodeURIComponent(direction)}` : '';
  return api.delete<{success: boolean}>(`/messages${query}`);
}

export function listCalls(params: {page?: number; pageSize?: number} = {}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 50),
    direction: 'call',
  });
  return api.get<{items: CallItem[]; total: number; page: number; pageSize: number}>(`/messages?${query}`);
}

export function clearCalls() {
  return api.delete<{success: boolean}>('/messages?direction=call');
}

export function deleteCall(id: number) {
  return api.delete<{success: boolean}>(`/messages/${id}`);
}
