// Fetch API 客户端

const BASE_URL = '/api';

interface RequestOptions extends RequestInit {
    params?: Record<string, any>;
}

class ApiClient {
    private readonly baseURL: string;

    constructor(baseURL: string) {
        this.baseURL = baseURL;
    }

    private buildURL(path: string, params?: Record<string, any>): string {
        const url = new URL(this.baseURL + path, window.location.origin);

        if (params) {
            Object.entries(params).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    url.searchParams.append(key, String(value));
                }
            });
        }

        return url.toString();
    }

    private async request<T>(
        path: string,
        options: RequestOptions = {}
    ): Promise<T> {
        const {params, ...fetchOptions} = options;

        const url = this.buildURL(path, params);

        // 获取 token
        const token = localStorage.getItem('token');

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
            ...fetchOptions.headers,
        };

        try {
            const response = await fetch(url, {
                ...fetchOptions,
                headers,
            });

            // 处理未授权
            if (response.status === 401) {
                // 清除 localStorage 中的 token
                localStorage.removeItem('token');
                localStorage.removeItem('username');

                // 跳转到登录页面
                if (typeof window !== 'undefined') {
                    window.location.href = '/login';
                }
                throw new Error('未授权，请重新登录');
            }

            // 处理错误响应
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `HTTP ${response.status}: ${response.statusText}`);
            }

            // 解析 JSON 响应
            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API 请求失败:', error);
            throw error;
        }
    }

    async get<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request<T>(path, {...options, method: 'GET'});
    }

    async post<T>(path: string, data?: any, options?: RequestOptions): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async put<T>(path: string, data?: any, options?: RequestOptions): Promise<T> {
        return this.request<T>(path, {
            ...options,
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    async delete<T>(path: string, options?: RequestOptions): Promise<T> {
        return this.request<T>(path, {...options, method: 'DELETE'});
    }
}

const apiClient = new ApiClient(BASE_URL);

export default apiClient;
