import {useEffect} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {oidcLogin} from '@/api/auth.ts';
import {toast} from 'sonner';

const OIDCCallback = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    useEffect(() => {
        const handleCallback = async () => {
            // 检查是否有错误参数
            const error = searchParams.get('error');
            if (error) {
                const errorDescription = searchParams.get('error_description');
                const errorMessage = errorDescription
                    ? decodeURIComponent(errorDescription)
                    : `认证失败: ${error}`;
                toast.error(errorMessage);
                navigate('/login');
                return;
            }

            const code = searchParams.get('code');
            const state = searchParams.get('state');

            if (!code || !state) {
                toast.error('缺少认证参数');
                navigate('/login');
                return;
            }

            try {
                const response = await oidcLogin(code, state);
                const {token, username} = response;

                // 保存到 localStorage
                localStorage.setItem('token', token);
                localStorage.setItem('username', username);

                toast.success('登录成功');
                navigate('/');
            } catch (error: any) {
                toast.error(error.response?.data?.error || 'OIDC 认证失败');
                navigate('/login');
            }
        };

        handleCallback();
    }, [searchParams, navigate]);

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="text-center">
                <div className="text-lg mb-2">正在处理 OIDC 认证...</div>
                <div className="text-gray-500">请稍候</div>
            </div>
        </div>
    );
};

export default OIDCCallback;
