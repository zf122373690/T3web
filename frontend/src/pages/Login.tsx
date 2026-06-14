import {FormEvent, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Lock, User} from 'lucide-react';
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
      <form className="login-panel" onSubmit={submit}>
        <div className="login-title">UART 短信转发器</div>
        <div className="login-subtitle">请输入管理账号进入控制台</div>
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
        <div className="hint">默认账号：admin / admin123</div>
      </form>
    </div>
  );
}
