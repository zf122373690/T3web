import {useEffect, useMemo, useState} from 'react';
import {Link, Outlet, useLocation, useNavigate} from 'react-router-dom';
import {Cable, LogOut, MessageSquare, Moon, Radar, Router, Smartphone, Sun} from 'lucide-react';
import {logout} from '../api/auth';

type WorkMode = 'serial' | 'lan';
type ThemeMode = 'light' | 'dark';
type NavItem = {to: string; label: string; icon: typeof Cable; modes?: WorkMode[]};

const nav: NavItem[] = [
  {to: '/', label: '模式选择', icon: Cable},
  {to: '/serial', label: '串口配置', icon: Smartphone, modes: ['serial']},
  {to: '/devices', label: '局域网设备', icon: Router, modes: ['lan']},
  {to: '/messages', label: '短信/通话记录', icon: MessageSquare, modes: ['lan']},
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

  const visibleNav = useMemo(() => nav.filter((item) => !item.modes || item.modes.includes(currentMode)), [currentMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('t3-theme', theme);
  }, [theme]);

  const switchMode = (mode: WorkMode) => {
    localStorage.setItem('t3-work-mode', mode);
    navigate(mode === 'serial' ? '/serial' : '/devices', {replace: true});
  };

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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T3</div>
          <div>
            <strong>T3 控制台</strong>
            <span>串口离线 / 局域网接管</span>
          </div>
        </div>
        <nav className="nav">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
            return (
              <Link key={item.to} to={item.to} className={active ? 'nav-link active' : 'nav-link'}>
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div>
            <span>当前账号</span>
            <strong>{localStorage.getItem('username') || 'admin'}</strong>
          </div>
          <button className="logout-button" onClick={handleLogout}>
            <LogOut size={18} />
            退出登录
          </button>
        </div>
      </aside>
      <main className="content">
        <div className="top-mode-switch">
          <div className="top-mode-copy">
            <span>当前功能模式</span>
            <strong>{currentMode === 'serial' ? '串口模式：设备需插入电脑' : '局域网模式：设备需提前连好 WiFi'}</strong>
          </div>
          <div className="mode-switch-buttons">
            <button className={currentMode === 'serial' ? 'active' : ''} onClick={() => switchMode('serial')}><Smartphone size={15} /> 串口</button>
            <button className={currentMode === 'lan' ? 'active' : ''} onClick={() => switchMode('lan')}><Router size={15} /> 局域网</button>
          </div>
          <button className="theme-toggle-button" onClick={toggleTheme} aria-label="切换主题">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? '白天' : '暗黑'}
          </button>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
