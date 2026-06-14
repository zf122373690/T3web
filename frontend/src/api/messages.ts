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
}

export interface MessageStats {
  total: number;
  today: number;
  week: number;
  failed: number;
}

export function listMessages(params: {page?: number; pageSize?: number; search?: string} = {}) {
  const query = new URLSearchParams({
    page: String(params.page ?? 1),
    page_size: String(params.pageSize ?? 50),
    search: params.search ?? '',
  });
  return api.get<{items: MessageItem[]; total: number; page: number; pageSize: number}>(`/messages?${query}`);
}

export function getMessageStats() {
  return api.get<MessageStats>('/messages/stats');
}

export function deleteMessage(id: number) {
  return api.delete<{success: boolean}>(`/messages/${id}`);
}

export function clearMessages() {
  return api.delete<{success: boolean}>('/messages');
}
