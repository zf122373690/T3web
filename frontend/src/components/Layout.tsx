import {useEffect, useState} from 'react';
import {Cable, LogOut, MessageSquare, MonitorSmartphone, Moon, Radio, Sun, Wifi} from 'lucide-react';
import {Outlet, useLocation, useNavigate} from 'react-router-dom';
import {logout} from '../api/auth';

type ThemeMode = 'light' | 'dark';

const lanPages = ['/devices', '/messages', '/scan', '/calls'];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('t3-theme') === 'dark' ? 'dark' : 'light'));
  const isSerialPage = location.pathname.startsWith('/serial');
  const isLanPage = lanPages.some((path) => location.pathname.startsWith(path));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('t3-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((value) => value === 'dark' ? 'light' : 'dark');

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      navigate('/login', {replace: true});
    }
  };

  const switchMode = (mode: 'serial' | 'lan') => {
    localStorage.setItem('t3-work-mode', mode);
    navigate(mode === 'serial' ? '/serial' : '/devices');
  };

  return (
    <div className="app-shell-topnav">
      <header className="top-nav-bar">
        <button className="top-nav-logo" onClick={() => navigate(isSerialPage ? '/serial' : isLanPage ? '/devices' : '/')}>
          <span className="brand-mark-sm">T3</span>
          <span className="top-nav-logo-copy">
            <strong>本地设备助手</strong>
            <small>{isSerialPage ? '串口工作台' : isLanPage ? '局域网控制台' : '连接方式'}</small>
          </span>
        </button>

        <nav className="top-nav-tabs" aria-label="主导航">
          {isSerialPage ? (
            <button className="top-nav-tab active" onClick={() => navigate('/serial')}>
              <Cable size={16} />
              串口配置
            </button>
          ) : null}
          {isLanPage ? (
            <>
              <button className={location.pathname.startsWith('/devices') ? 'top-nav-tab active' : 'top-nav-tab'} onClick={() => navigate('/devices')}>
                <MonitorSmartphone size={16} />
                设备管理
              </button>
              <button className={location.pathname.startsWith('/messages') ? 'top-nav-tab active' : 'top-nav-tab'} onClick={() => navigate('/messages')}>
                <MessageSquare size={16} />
                短信记录
              </button>
            </>
          ) : null}
        </nav>

        <div className="top-nav-right">
          <button className="top-nav-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          {isSerialPage ? (
            <button className="top-nav-serial-btn" onClick={() => switchMode('lan')}>
              <Wifi size={15} />
              局域网模式
            </button>
          ) : null}
          {isLanPage ? (
            <button className="top-nav-serial-btn" onClick={() => switchMode('serial')}>
              <Radio size={15} />
              串口模式
            </button>
          ) : null}
          <button className="top-nav-logout" onClick={handleLogout} title="退出登录">
            <LogOut size={15} />
            <span>退出</span>
          </button>
        </div>
      </header>
      <main className="content-topnav">
        <Outlet />
      </main>
    </div>
  );
}
