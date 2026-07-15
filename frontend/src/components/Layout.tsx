import {useEffect, useMemo, useState} from 'react';
import {Link, Outlet, useLocation, useNavigate} from 'react-router-dom';
import {LogOut, MessageSquare, Moon, Sun, Wifi, ArrowLeft} from 'lucide-react';
import {logout} from '../api/auth';

type ThemeMode = 'light' | 'dark';

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('t3-theme') === 'dark' ? 'dark' : 'light'));

  // LAN mode pages use top nav bar instead of sidebar
  const isLanPage = ['/devices', '/messages', '/scan'].some(p => location.pathname.startsWith(p));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('t3-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((v) => v === 'dark' ? 'light' : 'dark');
  const handleLogout = async () => {
    try { await logout(); } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      navigate('/login', {replace: true});
    }
  };

  const switchToSerial = () => {
    localStorage.removeItem('t3-work-mode');
    navigate('/');
  };

  if (isLanPage) {
    // Top navigation bar layout for LAN mode
    const activeTab = location.pathname.startsWith('/messages') ? 'messages' : 
                      location.pathname.startsWith('/scan') ? 'scan' : 'devices';
    return (
      <div className="app-shell-topnav">
        <header className="top-nav-bar">
          <div className="top-nav-left">
            <div className="top-nav-logo">
              <span className="brand-mark-sm">T3</span>
              <span>📡 T3短信转发器控制台</span>
            </div>
          </div>
          <nav className="top-nav-tabs">
            <button
              className={activeTab === 'devices' ? 'top-nav-tab active' : 'top-nav-tab'}
              onClick={() => navigate('/devices')}
            >
              📱 设备管理
            </button>
            <button
              className={activeTab === 'messages' ? 'top-nav-tab active' : 'top-nav-tab'}
              onClick={() => navigate('/messages')}
            >
              💬 短信记录
            </button>
          </nav>
          <div className="top-nav-right">
            <button className="top-nav-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '白天模式' : '暗黑模式'}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="top-nav-serial-btn" onClick={switchToSerial} title="切换到串口模式">
              <ArrowLeft size={14} /> 串口模式
            </button>
            <button className="top-nav-logout" onClick={handleLogout}>
              🚪 退出
            </button>
          </div>
        </header>
        <main className="content-topnav">
          <Outlet />
        </main>
      </div>
    );
  }

  // Serial mode keeps original sidebar
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link to="/" className="sidebar-brand">
          <div className="sidebar-brand-mark">T3</div>
          <div className="sidebar-brand-text">
            <strong>T3短信转发器控制台</strong>
            <span>SMS Forwarder</span>
          </div>
        </Link>
        <nav className="sidebar-nav">
          <Link to="/" className="sidebar-nav-item"><span>串口配置</span></Link>
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-logout" onClick={handleLogout}>
            <LogOut size={16} />
            <span>退出登录</span>
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}