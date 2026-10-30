import {Cable, Home, LogOut, MessageSquare, Moon, Radio, Smartphone, Sun, User} from 'lucide-react';
import {useEffect, useState} from 'react';
import {Outlet, useLocation, useNavigate} from 'react-router-dom';
import {logout} from '../api/auth';

const lanPages = ['/devices', '/messages', '/calls', '/dashboard', '/profile'];

const pageTitle: Record<string, string> = {
  '/dashboard': '仪表盘',
  '/devices': '设备列表',
  '/messages': '所有短信',
  '/calls': '通话记录',
  '/profile': '个人资料',
  '/serial': '串口工作台',
};

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 960px)').matches);
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 960px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('t3-theme') === 'dark' ? 'dark' : 'light'));
  const isSerialPage = location.pathname.startsWith('/serial');
  const isLanPage = lanPages.some((path) => location.pathname.startsWith(path));
  const title = pageTitle[Object.keys(pageTitle).find((key) => location.pathname.startsWith(key)) || ''] || '本地设备助手';

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('t3-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#171512' : '#f7f0e5');
  }, [theme]);

  const toggleTheme = () => setTheme((value) => (value === 'dark' ? 'light' : 'dark'));

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
    navigate(mode === 'serial' ? '/serial' : '/dashboard');
  };

  if (isDesktop) {
    return (
      <div className="app-shell-desktop">
        <aside className="side-nav">
          <div className="side-nav-brand">
            <span className="brand-mark-sm">T3</span>
            <div className="top-nav-logo-copy">
              <strong>短信转发器</strong>
              <small>{isSerialPage ? '串口工作台' : '管理系统'}</small>
            </div>
          </div>

          <nav className="side-menu" aria-label="侧边菜单">
            {isSerialPage ? (
              <button className="side-menu-item active" onClick={() => navigate('/serial')}>
                <Cable size={18} />
                <span>串口工作台</span>
              </button>
            ) : (
              <>
                <button className={`side-menu-item ${location.pathname === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>
                  <Home size={18} />
                  <span>仪表盘</span>
                </button>
                <button className={`side-menu-item ${location.pathname.startsWith('/devices') ? 'active' : ''}`} onClick={() => navigate('/devices')}>
                  <Smartphone size={18} />
                  <span>设备列表</span>
                </button>
                <button className={`side-menu-item ${location.pathname.startsWith('/messages') || location.pathname.startsWith('/calls') ? 'active' : ''}`} onClick={() => navigate('/messages')}>
                  <MessageSquare size={18} />
                  <span>所有短信</span>
                </button>
                <button className={`side-menu-item ${location.pathname.startsWith('/profile') ? 'active' : ''}`} onClick={() => navigate('/profile')}>
                  <User size={18} />
                  <span>个人资料</span>
                </button>
              </>
            )}
          </nav>

          <div className="side-nav-footer">
            {isSerialPage ? (
              <button className="side-menu-item" onClick={() => switchMode('lan')}>
                <Radio size={18} />
                <span>局域网模式</span>
              </button>
            ) : (
              <button className="side-menu-item" onClick={() => switchMode('serial')}>
                <Cable size={18} />
                <span>串口模式</span>
              </button>
            )}
            <div className="side-nav-actions">
              <button className="top-nav-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}>
                {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              </button>
              <button className="top-nav-icon-btn" onClick={handleLogout} title="退出登录">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </aside>

        <main className="content-desktop">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell-topnav">
      <header className="top-nav-bar">
        <button className="top-nav-logo" onClick={() => navigate(isSerialPage ? '/serial' : isLanPage ? '/dashboard' : '/')}>
          <span className="brand-mark-sm">T3</span>
          <span className="top-nav-logo-copy">
            <strong>{title}</strong>
            <small>{isSerialPage ? '串口工作台' : '短信转发器管理系统'}</small>
          </span>
        </button>

        <div className="top-nav-right">
          <button className="top-nav-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          {isSerialPage ? (
            <button className="top-nav-serial-btn" onClick={() => switchMode('lan')}>
              <Radio size={14} />
              局域网模式
            </button>
          ) : null}
          {isLanPage ? (
            <button className="top-nav-serial-btn" onClick={() => switchMode('serial')}>
              <Cable size={14} />
              串口
            </button>
          ) : null}
          <button className="top-nav-icon-btn" onClick={handleLogout} title="退出登录">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="content-topnav">
        <Outlet />
      </main>

      {isSerialPage || isLanPage ? (
        <nav className="bottom-nav" aria-label="底部导航">
          {isSerialPage ? (
            <div className="bottom-nav-group">
              <button className="bottom-nav-item active" onClick={() => navigate('/serial')}>
                <Cable size={21} />
                <span>串口配置</span>
              </button>
            </div>
          ) : (
            <div className="bottom-nav-group">
              <button className={`bottom-nav-item ${location.pathname === '/dashboard' ? 'active' : ''}`} onClick={() => navigate('/dashboard')}>
                <Home size={21} />
                <span>仪表盘</span>
              </button>
              <button className={`bottom-nav-item ${location.pathname.startsWith('/devices') ? 'active' : ''}`} onClick={() => navigate('/devices')}>
                <Smartphone size={21} />
                <span>设备列表</span>
              </button>
              <button className={`bottom-nav-item ${location.pathname.startsWith('/messages') || location.pathname.startsWith('/calls') ? 'active' : ''}`} onClick={() => navigate('/messages')}>
                <MessageSquare size={21} />
                <span>所有短信</span>
              </button>
              <button className={`bottom-nav-item ${location.pathname.startsWith('/profile') ? 'active' : ''}`} onClick={() => navigate('/profile')}>
                <User size={21} />
                <span>个人资料</span>
              </button>
            </div>
          )}
        </nav>
      ) : null}
    </div>
  );
}
