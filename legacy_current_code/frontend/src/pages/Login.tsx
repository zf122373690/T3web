import {type FormEvent, useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Lock, User} from 'lucide-react';
import {getAuthConfig, getOIDCAuthURL, login as loginApi, type AuthConfig} from '@/api/auth';
import {toast} from 'sonner';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
    const [configLoading, setConfigLoading] = useState(true);
    const navigate = useNavigate();

    const passwordLoginEnabled = authConfig?.passwordEnabled !== false;
    const oidcLoginEnabled = authConfig?.oidcEnabled === true;

    // 加载认证配置
    useEffect(() => {
        getAuthConfig()
            .then(config => {
                console.log('认证配置:', config);
                const normalizedConfig = {
                    ...config,
                    passwordEnabled:
                        config.passwordEnabled ??
                        (config as any).password_enabled ??
                        (config as any).enablePassword ??
                        (config as any).password,
                    oidcEnabled:
                        config.oidcEnabled ??
                        (config as any).oidc_enabled ??
                        (config as any).enableOidc ??
                        (config as any).oidc,
                };
                setAuthConfig(normalizedConfig);
                setConfigLoading(false);
            })
            .catch(error => {
                console.error('获取认证配置失败', error);
                toast.error('获取认证配置失败');
                setAuthConfig({
                    oidcEnabled: false,
                    githubEnabled: false,
                    passwordEnabled: true,
                    hasPasswordConfigured: true,
                });
                setConfigLoading(false);
            });
    }, []);

    const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (loading || !username || !password) {
            return;
        }

        setLoading(true);
        try {
            const response = await loginApi({username, password});

            // 保存到 localStorage
            localStorage.setItem('token', response.token);
            localStorage.setItem('username', response.username);

            toast.success('登录成功');
            navigate('/');
        } catch (error) {
            toast.error('登录失败：' + (error instanceof Error ? error.message : '未知错误'));
        } finally {
            setLoading(false);
        }
    };

    const handleOIDCLogin = async () => {
        try {
            setLoading(true);
            const {authUrl} = await getOIDCAuthURL();
            // 跳转到 OIDC 认证页面
            window.location.href = authUrl;
        } catch (error) {
            toast.error('获取 OIDC 认证 URL 失败');
            setLoading(false);
        }
    };

    const submitDisabled = loading || !username || !password;

    return (
        <div
            className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50 flex items-center justify-center px-4 py-10">
            <Card className="w-full max-w-md shadow-xl border border-slate-100">
                <CardHeader className="space-y-2 text-center pb-2">
                    <CardTitle className="text-3xl font-semibold tracking-tight text-slate-900 mt-6">
                        UART 短信转发器
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 pb-7 space-y-6">
                    {configLoading ? (
                        <div className="text-center py-8">
                            <div className="text-slate-500">加载中...</div>
                        </div>
                    ) : !passwordLoginEnabled && !oidcLoginEnabled ? (
                        <div className="text-center py-8">
                            <div className="text-slate-500">未配置任何登录方式</div>
                        </div>
                    ) : (
                        <>
                            {passwordLoginEnabled && (
                                <form onSubmit={handleLogin} className="space-y-5">
                                    <div className="space-y-2">
                                        <label htmlFor="username"
                                               className="text-sm font-medium text-slate-800 block">
                                            用户名
                                        </label>
                                        <div className="relative">
                                            <User
                                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                                            <Input
                                                id="username"
                                                type="text"
                                                placeholder="请输入用户名"
                                                value={username}
                                                onChange={(event) => setUsername(event.target.value)}
                                                className="pl-10 h-11"
                                                disabled={loading}
                                                required
                                                autoComplete="username"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label htmlFor="password"
                                               className="text-sm font-medium text-slate-800 block">
                                            密码
                                        </label>
                                        <div className="relative">
                                            <Lock
                                                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
                                            <Input
                                                id="password"
                                                type="password"
                                                placeholder="请输入密码"
                                                value={password}
                                                onChange={(event) => setPassword(event.target.value)}
                                                className="pl-10 h-11"
                                                disabled={loading}
                                                required
                                                autoComplete="current-password"
                                            />
                                        </div>
                                    </div>

                                    <Button
                                        type="submit"
                                        className="w-full h-11 text-base font-medium cursor-pointer"
                                        disabled={submitDisabled}
                                    >
                                        {loading ? '登录中...' : '登录'}
                                    </Button>
                                </form>
                            )}

                            {passwordLoginEnabled && oidcLoginEnabled && (
                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t"/>
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-white px-2 text-slate-500">或</span>
                                    </div>
                                </div>
                            )}

                            {oidcLoginEnabled && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className="w-full h-11 text-base font-medium cursor-pointer"
                                    onClick={handleOIDCLogin}
                                    disabled={loading}
                                >
                                    {loading ? '跳转中...' : 'OIDC 登录'}
                                </Button>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
