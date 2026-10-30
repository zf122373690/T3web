const API_BASE = '/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const response = await fetch(API_BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const data = await response.json();
      message = data.detail || data.error || JSON.stringify(data);
    } catch {
      message = await response.text();
    }
    if (response.status === 401 && path !== '/login') {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      window.location.replace('/login');
    }
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, {method: 'POST', body: JSON.stringify(body ?? {})}),
  delete: <T>(path: string) => request<T>(path, {method: 'DELETE'}),
  upload: <T>(path: string, form: FormData) => fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      ...(localStorage.getItem('token') ? {Authorization: `Bearer ${localStorage.getItem('token')}`} : {}),
    },
    body: form,
  }).then(async (response) => {
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      try {
        const data = await response.json();
        message = data.detail || data.error || JSON.stringify(data);
      } catch {
        message = await response.text();
      }
      throw new ApiError(response.status, message);
    }
    return response.json() as Promise<T>;
  }),
};
