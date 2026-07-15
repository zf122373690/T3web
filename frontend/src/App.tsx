import {Activity, ArrowRight, CheckCircle2, Cpu, DatabaseZap, MessageSquareText, Radar, ShieldCheck, Smartphone, Sparkles, Wifi} from 'lucide-react';

const metrics = [
  {label: '在线设备', value: '128', trend: '+18%', icon: Smartphone},
  {label: '今日转发', value: '42.6k', trend: '99.98%', icon: MessageSquareText},
  {label: '平均延迟', value: '84ms', trend: '-31ms', icon: Activity},
  {label: '异常拦截', value: '317', trend: '自动处理', icon: ShieldCheck},
];

const devices = [
  {name: 'T3-Gateway A17', zone: '华东机房 · Rack 08', status: '在线', load: 78},
  {name: 'T3-Serial C04', zone: '深圳现场 · COM6', status: '同步中', load: 54},
  {name: 'T3-LAN Node 29', zone: '北京办公室 · 10.0.2.29', status: '在线', load: 91},
  {name: 'T3-Edge M12', zone: '成都仓储 · Wi-Fi 6', status: '在线', load: 66},
];

const messages = [
  {time: '09:18:42', source: '招商银行', content: '验证码已识别并转发至企业微信审批群', type: 'SMS'},
  {time: '09:20:03', source: 'IoT SIM 042', content: '设备心跳包完成入库，自动标记链路健康', type: 'MQTT'},
  {time: '09:23:11', source: 'COM6', content: '串口上行数据解析成功，关联到客户工单 #8421', type: 'AT'},
  {time: '09:27:36', source: '风控规则', content: '高频号码被拦截，已进入人工复核队列', type: 'Rule'},
];

const features = [
  {title: '多通道接入', text: '同时覆盖局域网设备、串口模组、MQTT 上报与历史兼容入口。'},
  {title: '实时运营驾驶舱', text: '用统一视图观察设备健康、消息吞吐、失败率和异常队列。'},
  {title: '低代码告警策略', text: '用可组合规则把验证码、设备告警、工单事件推送到目标渠道。'},
];

const timeline = ['设备发现', '协议握手', '消息解析', '安全过滤', '多端分发'];

export default function App() {
  return (
    <main className="demo-site">
      <section className="demo-hero">
        <nav className="demo-nav" aria-label="站点导航">
          <a className="demo-brand" href="#top" aria-label="T3web 首页">
            <span>T3</span>
            <strong>T3web Signal Desk</strong>
          </a>
          <div className="demo-nav-links">
            <a href="#metrics">指标</a>
            <a href="#devices">设备</a>
            <a href="#features">能力</a>
          </div>
          <a className="demo-nav-action" href="#contact">预约演示</a>
        </nav>

        <div id="top" className="demo-hero-grid">
          <div className="demo-hero-copy">
            <div className="demo-kicker"><Sparkles size={16} /> 模拟数据演示站点</div>
            <h1>把分散的短信、串口与设备信号，收束成一张实时运营图。</h1>
            <p>
              T3web 演示版展示一个面向设备消息转发场景的单页站点：从设备接入、消息流转到安全告警，所有数据均为模拟生成，适合用于产品介绍和方案展示。
            </p>
            <div className="demo-hero-actions">
              <a className="demo-primary" href="#metrics">查看驾驶舱 <ArrowRight size={18} /></a>
              <a className="demo-secondary" href="#features">了解能力</a>
            </div>
          </div>

          <div className="demo-command-card" aria-label="实时命令中心预览">
            <div className="demo-card-topline">
              <span>Live Command Center</span>
              <strong>99.98%</strong>
            </div>
            <div className="demo-radar">
              <div className="demo-radar-core"><Radar size={34} /></div>
              <span className="demo-orbit one" />
              <span className="demo-orbit two" />
              <span className="demo-orbit three" />
            </div>
            <div className="demo-flow">
              {timeline.map((item, index) => (
                <div key={item} className="demo-flow-step">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="metrics" className="demo-section demo-metrics-section">
        <div className="demo-section-heading">
          <span>Operational Snapshot</span>
          <h2>模拟运营指标</h2>
          <p>用接近真实后台的指标结构展示核心价值，但不依赖任何真实接口。</p>
        </div>
        <div className="demo-metric-grid">
          {metrics.map((metric) => {
            const Icon = metric.icon;
            return (
              <article key={metric.label} className="demo-metric-card">
                <Icon size={22} />
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.trend}</small>
              </article>
            );
          })}
        </div>
      </section>

      <section id="devices" className="demo-section demo-operations-grid">
        <div className="demo-panel demo-device-panel">
          <div className="demo-panel-heading">
            <span><Wifi size={15} /> 设备态势</span>
            <strong>4 个示例节点</strong>
          </div>
          <div className="demo-device-list">
            {devices.map((device) => (
              <article key={device.name} className="demo-device-card">
                <div>
                  <strong>{device.name}</strong>
                  <span>{device.zone}</span>
                </div>
                <em>{device.status}</em>
                <div className="demo-load"><span style={{width: `${device.load}%`}} /></div>
              </article>
            ))}
          </div>
        </div>

        <div className="demo-panel demo-message-panel">
          <div className="demo-panel-heading">
            <span><DatabaseZap size={15} /> 消息流水</span>
            <strong>实时模拟</strong>
          </div>
          <div className="demo-message-stream">
            {messages.map((message) => (
              <article key={`${message.time}-${message.source}`} className="demo-message-row">
                <code>{message.time}</code>
                <div>
                  <span>{message.type} · {message.source}</span>
                  <strong>{message.content}</strong>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="demo-section demo-feature-section">
        <div className="demo-section-heading narrow">
          <span>Why T3web</span>
          <h2>为消息中继与设备管理而设计</h2>
        </div>
        <div className="demo-feature-grid">
          {features.map((feature) => (
            <article key={feature.title} className="demo-feature-card">
              <CheckCircle2 size={22} />
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="contact" className="demo-cta">
        <div>
          <span><Cpu size={16} /> Demo Ready</span>
          <h2>这是一个可直接运行的单页演示站点。</h2>
          <p>页面中的设备、消息和指标均来自本地模拟数组，后续可以很容易替换成真实 API。</p>
        </div>
        <a className="demo-primary light" href="mailto:demo@t3web.local">联系演示 <ArrowRight size={18} /></a>
      </section>
    </main>
  );
}
