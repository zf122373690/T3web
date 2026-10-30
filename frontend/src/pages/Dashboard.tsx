import {useEffect, useMemo, useState, type CSSProperties} from 'react';
import {MonitorSmartphone, MessageSquare, Wifi, LineChart} from 'lucide-react';
import {useNavigate} from 'react-router-dom';
import {listDevices, type DeviceItem} from '../api/devices';

// 模拟历史在线率数据（最近7天）
interface DailyStat {
  date: string;
  onlineRate: number;
  total: number;
  online: number;
}

// 生成模拟历史数据
function generateMockHistory(): DailyStat[] {
  const today = new Date();
  const data: DailyStat[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const dateStr = date.toLocaleDateString('zh-CN', {month: '2-digit', day: '2-digit'});
    // 模拟波动数据
    const baseRate = 80 + Math.random() * 15;
    const noise = (Math.random() - 0.5) * 10;
    const onlineRate = Math.max(50, Math.min(100, Math.round(baseRate + noise)));
    const total = 5 + Math.floor(Math.random() * 3);
    const online = Math.round(total * (onlineRate / 100));
    data.push({date: dateStr, onlineRate, total, online});
  }
  return data;
}

function useCountUp(target: number, ms = 700) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    setVal(0);
    const t0 = performance.now();
    const id = window.setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / ms);
      setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p >= 1) window.clearInterval(id);
    }, 16);
    return () => window.clearInterval(id);
  }, [target, ms]);
  return val;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [items, setItems] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());
  const [history, setHistory] = useState<DailyStat[]>([]);

  const stats = useMemo(() => {
    const total = items.length;
    const online = items.filter((i) => i.status === 'online').length;
    const noSim = items.filter((i) => !(i.sim1?.present || i.sim1?.number) && !(i.sim2?.present || i.sim2?.number)).length;
    const registered = items.filter((i) => i.sim1?.registered || i.sim2?.registered).length;
    return {total, online, noSim, registered};
  }, [items]);

  const offlineCount = stats.total - stats.online;
  const onlineRate = stats.total ? Math.round((stats.online / stats.total) * 100) : 0;
  const tone = offlineCount === 0 ? 'perfect' : onlineRate >= 85 ? 'good' : onlineRate >= 60 ? 'warn' : 'bad';
  const stateLabel = offlineCount === 0 ? '状态优秀' : onlineRate >= 85 ? '状态良好' : onlineRate >= 60 ? '需要关注' : '状态不佳';
  const shownRate = useCountUp(loading ? 0 : onlineRate);
  const healthTip = !stats.total
    ? '暂无设备，点击设备列表右下角 ＋ 添加。'
    : offlineCount === 0
      ? `全部 ${stats.total} 台在线，运行正常。`
      : `${offlineCount} 台离线，建议检查网线 / 供电或最近心跳。`;

  useEffect(() => {
    listDevices().then((data) => setItems(data.items)).catch(() => setItems([])).finally(() => setLoading(false));
    const timer = window.setInterval(() => setClock(new Date()), 30_000);
    // 初始化历史数据
    setHistory(generateMockHistory());
    return () => window.clearInterval(timer);
  }, []);

  const username = localStorage.getItem('username') || '用户';

  return (
    <section className="page dashboard-page">
      <div className="dash-hello">
        <div>
          <h1>你好，{username}</h1>
          <p>{clock.toLocaleDateString('zh-CN', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'})}</p>
        </div>
        <span className="dash-mode-chip"><Wifi size={14} />局域网模式</span>
      </div>

      <div className="dash-stats">
        <button className="dash-stat" onClick={() => navigate('/devices')}>
          <strong>{stats.total}</strong>
          <span>设备总数</span>
        </button>
        <button className="dash-stat online" onClick={() => navigate('/devices')}>
          <strong>{stats.online}</strong>
          <span>在线</span>
        </button>
        <button className="dash-stat nosim" onClick={() => navigate('/devices')}>
          <strong>{stats.noSim}</strong>
          <span>无卡设备</span>
        </button>
        <button className="dash-stat registered" onClick={() => navigate('/devices')}>
          <strong>{stats.registered}</strong>
          <span>已注册</span>
        </button>
      </div>

      <div className="dash-quick">
        <button onClick={() => navigate('/devices')}><span className="quick-ico accent"><MonitorSmartphone size={20} /></span><span>设备管理</span></button>
        <button onClick={() => navigate('/messages')}><span className="quick-ico green"><MessageSquare size={20} /></span><span>短信记录</span></button>
      </div>

      <div className={`dash-health tone-${tone}`}>
        <div
          className="dash-health-ring"
          style={{'--pct': `${shownRate}%`} as CSSProperties}
        >
          <div className="dash-health-ring-core">
            <div className="dash-health-pct">{loading ? '—' : `${shownRate}%`}</div>
            <div className="dash-health-cap">在线率</div>
          </div>
        </div>

        <div className="dash-health-side">
          <div className="dash-health-head">
            <h2>设备健康度</h2>
            <span className="dash-health-state"><i />{loading ? '检测中' : stateLabel}</span>
          </div>
          <p className="dash-health-tip">{loading ? '正在读取设备状态…' : healthTip}</p>
          <div className="dash-health-pills">
            <span className="hp-online">在线 {loading ? '—' : stats.online}</span>
            <span className="hp-offline">离线 {loading ? '—' : offlineCount}</span>
            <span className="hp-total">总数 {loading ? '—' : stats.total}</span>
          </div>
        </div>
      </div>

      {/* 历史趋势图表 */}
      <div className="dash-history">
        <div className="dash-history-header">
          <h3><LineChart size={16} /> 近7天在线趋势</h3>
        </div>
        <div className="dash-history-chart">
          {/* 折线图容器 */}
          <div className="line-chart-container">
            <svg className="line-chart-svg" viewBox="0 0 1000 200" preserveAspectRatio="none">
              {/* 折线路径 */}
              <path
                className="line-chart-path"
                d={`M ${history.map((day, i) => {
                  const x = 100 + i * (800 / (history.length - 1));
                  const y = 200 - (day.onlineRate / 100) * 150 + 25;
                  return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
                }).join(' ')}`}
                fill="none"
                stroke={`var(--${tone === 'perfect' ? 'green' : tone === 'good' ? 'green' : tone === 'warn' ? 'amber' : 'red'})`}
                strokeWidth="3"
              />
              {/* 数据点 */}
              {history.map((day, i) => {
                const x = 100 + i * (800 / (history.length - 1));
                const y = 200 - (day.onlineRate / 100) * 150 + 25;
                return (
                  <circle
                    key={i}
                    className="line-chart-point"
                    cx={x}
                    cy={y}
                    r="5"
                    fill={`var(--${tone === 'perfect' ? 'green' : tone === 'good' ? 'green' : tone === 'warn' ? 'amber' : 'red'})`}
                  >
                    <title>{`${day.onlineRate}% 在线（${day.online}/${day.total}）`}</title>
                  </circle>
                );
              })}
            </svg>
            {/* 日期标签 */}
            <div className="line-chart-labels">
              {history.map((day, i) => (
                <div key={i} className="chart-date">{day.date.split('/')[1] || day.date}</div>
              ))}
            </div>
            {/* 百分比标签 */}
            <div className="line-chart-rate-labels">
              {[100, 80, 60, 40, 20, 0].map((rate) => (
                <div key={rate} className="chart-rate-label" style={{top: `${200 - (rate / 100) * 150 + 10}px`}}>
                  {rate}%
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
