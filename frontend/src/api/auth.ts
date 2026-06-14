import apiClient from './client';

export interface LoginRequest {
    username: string;
    password: string;
}

export interface LoginResponse {
    token: string;
    username: string;
    expiresAt: number;
}

// 认证配置
export interface AuthConfig {
    oidcEnabled: boolean;
    githubEnabled: boolean;
    passwordEnabled: boolean;
    hasPasswordConfigured: boolean;
}

// OIDC 认证 URL
export interface OIDCAuthURL {
    authUrl: string;
    state: string;
}

export const login = (request: LoginRequest): Promise<LoginResponse> => {
    return apiClient.post('/login', request);
};

// 获取认证配置
export const getAuthConfig = (): Promise<AuthConfig> => {
    return apiClient.get('/auth/config');
};

// 获取 OIDC 认证 URL
export const getOIDCAuthURL = (): Promise<OIDCAuthURL> => {
    return apiClient.get('/auth/oidc/url');
};

// OIDC 登录回调
export const oidcLogin = (code: string, state: string): Promise<LoginResponse> => {
    return apiClient.post('/auth/oidc/callback', {code, state});
};