import {useEffect, useState} from 'react';
import {listDevices} from '../api/devices';
import {getMessageStats, type MessageStats} from '../api/messages';

export default function Dashboard() {
  const [deviceCount, setDeviceCount] = useState(0);
  const [stats, setStats] = useState<MessageStats>({total: 0, today: 0, week: 0, failed: 0});
  const [status, setStatus] = useState('正常');

  useEffect(() => {
    const load = async () => {
      try {
        const [devices, messageStats] = await Promise.all([listDevices(), getMessageStats()]);
        setDeviceCount(devices.total);
        setStats(messageStats);
        setStatus('正常');
      } catch {
        setStatus('异常');
      }
    };
    void load();
  }, []);

  return (
    <section className="page">
      <h1>仪表盘</h1>
      <div className="grid">
        <div className="metric"><span>设备数量</span><strong>{deviceCount}</strong></div>
        <div className="metric"><span>今日短信</span><strong>{stats.today}</strong></div>
        <div className="metric"><span>短信总数</span><strong>{stats.total}</strong></div>
        <div className="metric"><span>系统状态</span><strong>{status}</strong></div>
      </div>
    </section>
  );
}
