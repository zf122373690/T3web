import {useEffect, useState} from 'react';
import {ArrowRight, Cable, ChevronRight, Info, LogOut, Radio, Shield, Wifi} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {logout} from '../api/auth';
import {getSystemVersion, type SystemVersionInfo} from '../api/devices';

export default function Profile() {
  const navigate = useNavigate();
  const [versionInfo, setVersionInfo] = useState<SystemVersionInfo | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const mode = localStorage.getItem('t3-work-mode') || 'lan';

  useEffect(() => {
    document.documentElement.dataset.theme = localStorage.getItem('t3-theme') === 'dark' ? 'dark' : 'light';
    getSystemVersion().then(setVersionInfo).catch(() => setVersionInfo(null));
  }, []);

  const switchMode = (m: 'serial' | 'lan') => {
    localStorage.setItem('t3-work-mode', m);
    navigate(m === 'serial' ? '/serial' : '/dashboard');
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('username');
      navigate('/login', {replace: true});
    }
  };

  const username = localStorage.getItem('username') || '用户';

  return (
    <section className="page profile-page">
      <div className="profile-hero">
        <span className="profile-avatar">{username.slice(0, 1).toUpperCase()}</span>
        <div>
          <h1>{username}</h1>
          <p>T3 本地设备助手</p>
          <span className="profile-badge"><Shield size={12} />管理员</span>
        </div>
      </div>

      <div className="profile-section">
        <h2>工作模式</h2>
        <button className="profile-row" onClick={() => switchMode('lan')} type="button">
          <span className="po-icon"><Wifi size={17} /></span>
          <span className="po-main"><strong>局域网控制台</strong><small>{mode === 'lan' ? '当前模式' : '切换到局域网设备管理'}</small></span>
          {mode === 'lan' ? <Shield size={15} className="arrow" /> : <ArrowRight size={17} className="arrow" />}
        </button>
        <button className="profile-row" onClick={() => switchMode('serial')} type="button">
          <span className="po-icon"><Cable size={17} /></span>
          <span className="po-main"><strong>串口工作台</strong><small>{mode === 'serial' ? '当前模式' : 'USB 串口离线配置'}</small></span>
          {mode === 'serial' ? <Shield size={15} className="arrow" /> : <ArrowRight size={17} className="arrow" />}
        </button>
      </div>

      <div className="profile-section">
        <h2>服务端信息</h2>
        <div className="profile-meta">
          <div><span>本地版本</span><strong>{versionInfo?.localVersion || '检测中'}</strong></div>
          <div><span>OTA 服务器</span><strong>{versionInfo?.otaServerVersion || versionInfo?.otaServerMessage || '检测中'}</strong></div>
          <div><span>固件升级源</span><strong>{versionInfo?.otaServerAvailable === false ? '不可用' : '可用'}</strong></div>
        </div>
      </div>

      <div className="profile-section">
        <button className="profile-row danger" onClick={() => void handleLogout()} disabled={loggingOut} type="button">
          <span className="po-icon"><LogOut size={17} /></span>
          <span className="po-main"><strong>{loggingOut ? '正在退出…' : '退出登录'}</strong></span>
          <ChevronRight size={17} className="arrow" />
        </button>
      </div>

      <p className="profile-foot"><Info size={11} style={{verticalAlign: -1}} /> T3 本地设备助手 · 局域网设备运维 · <Radio size={11} style={{verticalAlign: -1}} /> 串口模式随时切换</p>
    </section>
  );
}
