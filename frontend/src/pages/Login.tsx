import {FormEvent, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Lock, ShieldCheck, User, Waves} from 'lucide-react';
import {login} from '../api/auth';

export default function Login() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await login(username, password);
      localStorage.setItem('token', result.token);
      localStorage.setItem('username', result.username);
      navigate('/', {replace: true});
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <div className="login-copy">
          <div className="sidebar-brand-mark large">T3</div>
          <span className="eyebrow">Orbital Access</span>
          <h1>T3 ORBITAL LINK</h1>
          <p>进入深空通信控制台，统一管理局域网设备、MQTT 上报、本地串口配置、短信对话和通话归档。</p>
          <div className="login-feature-list">
            <div><ShieldCheck size={17} /> 会话令牌保护</div>
            <div><Waves size={17} /> 串口与网络设备统一接入</div>
          </div>
        </div>
        <form className="login-panel" onSubmit={submit}>
          <div className="login-title">登录控制台</div>
          <div className="login-subtitle">请输入管理账号继续操作</div>
          <label className="field">
            <span>用户名</span>
            <div className="input-with-icon">
              <User size={18} />
              <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </div>
          </label>
          <label className="field">
            <span>密码</span>
            <div className="input-with-icon">
              <Lock size={18} />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoFocus />
            </div>
          </label>
          {error && <div className="error">{error}</div>}
          <button className="primary-button" disabled={loading || !username || !password}>
            {loading ? '登录中...' : '登录'}
          </button>
          <div className="hint">默认账号：admin / admin</div>
        </form>
      </div>
    </div>
  );
}
