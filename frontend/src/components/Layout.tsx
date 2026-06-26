import {useEffect, useMemo, useState} from 'react';
import {Link, Outlet, useLocation, useNavigate} from 'react-router-dom';
import {Cable, LogOut, MessageSquare, Monitor, Moon, Radar, Router, Smartphone, Sun, Wifi, Usb} from 'lucide-react';
import {logout} from '../api/auth';

type WorkMode = 'serial' | 'lan';
type ThemeMode = 'light' | 'dark';

type NavItem = {
  to: string;
  label: string;
  icon: typeof Cable;
  modes?: WorkMode[];
};

const navItems: NavItem[] = [
  {to: '/', label: '模式选择', icon: Monitor},
  {to: '/serial', label: '串口配置', icon: Smartphone, modes: ['serial']},
  {to: '/devices', label: '局域网设备', icon: Router, modes: ['lan']},
  {to: '/messages', label: '短信/通话', icon: MessageSquare, modes: ['lan']},
  {to: '/scan', label: '局域网扫描', icon: Radar, modes: ['lan']},
];

function readMode(): WorkMode {
  return localStorage.getItem('t3-work-mode') === 'serial' ? 'serial' : 'lan';
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('t3-theme') === 'dark' ? 'dark' : 'light'));

  const currentMode: WorkMode =
    location.pathname.startsWith('/serial') ? 'serial' :
    location.pathname.startsWith('/devices') || location.pathname.startsWith('/scan') || location.pathname.startsWith('/messages') ? 'lan' :
    readMode();

  const visibleNav = useMemo(() => navItems.filter((item) => !item.modes || item.modes.includes(currentMode)), [currentMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('t3-theme', theme);
  }, [theme]);

  const switchMode = (mode: WorkMode) => {
    localStorage.setItem('t3-work-mode', mode);
    navigate(mode === 'serial' ? '/serial' : '/devices', {replace: true});
  };

  const toggleTheme = () => setTheme((v) => v === 'dark' ? 'light' : 'dark');
  const handleLogout = async () => {
    try { await logout(); } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      navigate('/login', {replace: true});
    }
  };

  const active = (path: string) => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        {/* Brand */}
        <Link to="/" className="sidebar-brand">
          <div className="sidebar-brand-mark">T3</div>
          <div className="sidebar-brand-text">
            <strong>T3 控制台</strong>
            <span>SMS Forwarder</span>
          </div>
        </Link>

        {/* Mode switch */}
        <div className="sidebar-mode">
          <button
            type="button"
            className={'sidebar-mode-btn' + (currentMode === 'serial' ? ' active' : '')}
            onClick={() => switchMode('serial')}
          >
            <Usb size={15} />
            <span>串口</span>
          </button>
          <button
            type="button"
            className={'sidebar-mode-btn' + (currentMode === 'lan' ? ' active' : '')}
            onClick={() => switchMode('lan')}
          >
            <Wifi size={15} />
            <span>局域网</span>
          </button>
        </div>

        {/* Navigation */}
        <nav className="sidebar-nav">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive = active(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={'sidebar-nav-item' + (isActive ? ' active' : '')}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {isActive && <span className="sidebar-nav-indicator" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{(localStorage.getItem('username') || 'admin').slice(0, 1).toUpperCase()}</div>
            <div className="sidebar-user-info">
              <span className="sidebar-user-name">{localStorage.getItem('username') || 'admin'}</span>
              <span className="sidebar-user-status">已登录</span>
            </div>
          </div>
          <div className="sidebar-footer-actions">
            <button className="sidebar-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '白天模式' : '暗黑模式'}>
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <button className="sidebar-logout" onClick={handleLogout}>
              <LogOut size={16} />
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </aside>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}