import {FormEvent, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {login} from '../api/auth';

export default function Login() {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(() => localStorage.getItem('t3-remember') === '1');
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
      if (remember) localStorage.setItem('t3-remember', '1');
      else localStorage.removeItem('t3-remember');
      navigate('/', {replace: true});
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <h1 className="login-title-main">短信转发器管理系统</h1>

      <form className="login-card" onSubmit={submit}>
        <label className="field">
          <span>账号</span>
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="请输入账号" />
        </label>
        <label className="field">
          <span>密码</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="请输入密码" />
        </label>

        <label className="login-remember">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
          记住登录
        </label>

        {error && <div className="error">{error}</div>}

        <button className="primary-button" disabled={loading || !username || !password} type="submit">
          {loading ? '登录中…' : '登 录'}
        </button>

        <div className="login-links">
          <span>默认账号 admin / admin</span>
          <button type="button" onClick={() => setPassword('')}>忘记密码？</button>
        </div>
      </form>

      <p className="login-foot">© 短信转发器管理系统 · T3 本地助手</p>
    </div>
  );
}
