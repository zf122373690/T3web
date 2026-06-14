import apiClient from './client';
import type {ListResult, Stats, Conversation, TextMessage} from './types';

// 获取统计信息
export const getStats = (): Promise<Stats> => {
    return apiClient.get('/messages/stats');
};

// 获取会话列表（按对方号码分组）
export const getConversations = (): Promise<Conversation[]> => {
    return apiClient.get('/messages/conversations');
};

// 获取指定会话的所有消息
export const getConversationMessages = (peer: string): Promise<TextMessage[]> => {
    return apiClient.get(`/messages/conversations/${encodeURIComponent(peer)}/messages`);
};

// 删除单条短信
export const deleteMessage = (id: string) => {
    return apiClient.delete(`/messages/${id}`);
};

// 删除整个会话（与某个联系人的所有消息）
export const deleteConversation = (peer: string) => {
    return apiClient.delete(`/messages/conversations/${encodeURIComponent(peer)}`);
};

// 清空所有短信
export const clearMessages = () => {
    return apiClient.delete('/messages');
};
