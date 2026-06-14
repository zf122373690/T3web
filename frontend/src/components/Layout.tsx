import {Link, Outlet, useLocation, useNavigate} from 'react-router-dom';
import {Gauge, LogOut, MessageSquare, Radar, Router, Smartphone} from 'lucide-react';
import {logout} from '../api/auth';

const nav = [
  {to: '/', label: '仪表盘', icon: Gauge},
  {to: '/serial', label: '串口控制', icon: Smartphone},
  {to: '/messages', label: '短信记录', icon: MessageSquare},
  {to: '/devices', label: '设备管理', icon: Router},
  {to: '/scan', label: '局域网扫描', icon: Radar},
];

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();

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
            <strong>UART 短信转发器</strong>
            <span>Clean rebuild</span>
          </div>
        </div>
        <nav className="nav">
          {nav.map((item) => {
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
        <button className="logout-button" onClick={handleLogout}>
          <LogOut size={18} />
          退出登录
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
