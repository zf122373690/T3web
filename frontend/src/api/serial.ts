import apiClient from './client';
import type { SendSMSRequest } from './types';

// 发送短信
export const sendSMS = (data: SendSMSRequest) => {
  return apiClient.post('/serial/sms', data);
};

// 获取设备状态（包含移动网络信息）
export const getStatus = () => {
  return apiClient.get('/serial/status');
};

// 设置飞行模式
export const setFlymode = (enabled: boolean) => {
  return apiClient.post('/serial/flymode', { enabled });
};

// 重启模块
export const rebootMcu = () => {
  return apiClient.post('/serial/reboot');
};

