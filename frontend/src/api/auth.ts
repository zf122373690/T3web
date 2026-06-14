import {api} from './client';

export interface LoginResponse {
  token: string;
  username: string;
  expiresAt: number;
}

export function login(username: string, password: string) {
  return api.post<LoginResponse>('/login', {username, password});
}

export function me() {
  return api.get<{username: string; expiresAt: number}>('/me');
}

export function logout() {
  return api.post<{success: boolean}>('/logout');
}
