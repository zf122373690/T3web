import {useEffect, useState} from 'react';
import {Activity, CalendarDays, Database, Router, ShieldCheck} from 'lucide-react';
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
    <section className="page dashboard-page">
      <div className="page-hero dashboard-hero">
        <div>
          <span className="eyebrow">Mission Overview</span>
          <h1>轨道总览</h1>
          <p>监控短信转发矩阵、串口链路和设备节点状态，快速判断当前通信中继是否稳定。</p>
        </div>
        <div className={status === '正常' ? 'health-card healthy' : 'health-card danger'}>
          <ShieldCheck size={22} />
          <div>
            <span>系统状态</span>
            <strong>{status}</strong>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card accent-blue">
          <span><Router size={16} /> 设备数量</span>
          <strong>{deviceCount}</strong>
          <small>已纳入管理的转发设备</small>
        </div>
        <div className="metric-card accent-green">
          <span><CalendarDays size={16} /> 今日记录</span>
          <strong>{stats.today}</strong>
          <small>今天新增的短信与通话记录</small>
        </div>
        <div className="metric-card accent-amber">
          <span><Database size={16} /> 记录总数</span>
          <strong>{stats.total}</strong>
          <small>数据库累计保存记录</small>
        </div>
        <div className="metric-card accent-red">
          <span><Activity size={16} /> 失败记录</span>
          <strong>{stats.failed}</strong>
          <small>需要关注的异常写入或发送</small>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="info-panel">
          <div className="panel-title compact">
            <div>
              <h2>运行概览</h2>
              <p>系统会把 MQTT 上报、历史兼容入口和串口识别结果沉淀到短信对话与通话记录页面。</p>
            </div>
          </div>
          <div className="insight-list">
            <div><span>本周记录</span><strong>{stats.week}</strong></div>
            <div><span>今日占比</span><strong>{stats.total ? `${Math.round((stats.today / stats.total) * 100)}%` : '0%'}</strong></div>
            <div><span>设备均值</span><strong>{deviceCount ? Math.round(stats.total / deviceCount) : 0}</strong></div>
          </div>
        </div>
        <div className="info-panel muted-panel">
          <div className="panel-title compact">
            <div>
              <h2>操作建议</h2>
              <p>若设备数为 0，先使用局域网扫描或在设备管理中手动添加 IP。串口设备请在串口控制页连接本机 COM 口。</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
