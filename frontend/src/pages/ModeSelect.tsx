import {Cable, Router, Settings2} from 'lucide-react';
import {useState} from 'react';
import {useNavigate} from 'react-router-dom';

type WorkMode = 'serial' | 'lan';

function selectMode(mode: WorkMode, navigate: ReturnType<typeof useNavigate>) {
  localStorage.setItem('t3-work-mode', mode);
  navigate(mode === 'serial' ? '/serial' : '/devices', {replace: true});
}

export default function ModeSelect() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<WorkMode | null>(() => {
    const saved = localStorage.getItem('t3-work-mode');
    return saved === 'serial' || saved === 'lan' ? saved : null;
  });

  return (
    <section className="page mode-select-page">
      <div className="page-hero mode-hero">
        <div>
          <span className="eyebrow">Access Mode</span>
          <h1>选择设备接入方式</h1>
          <p>串口模式和局域网模式的使用场景不同。首次进入请先选择当前设备的接入方式，后续也可以在右上角随时切换。</p>
        </div>
        <div className="mode-hero-badge"><Settings2 size={18} /> 可随时修改</div>
      </div>

      <div className="mode-choice-grid">
        <div className={selected === 'serial' ? 'mode-choice-card serial-choice selected' : 'mode-choice-card serial-choice'} onClick={() => setSelected('serial')}>
          <div className="mode-choice-icon"><Cable size={30} /></div>
          <span className="eyebrow">USB / 首次配置</span>
          <h2>串口模式</h2>
          <p>需要把 T3 / ESP32-C3 设备通过 USB 插入当前电脑。适合首次开箱、设备未联网、需要离线写入 WiFi、设备名称和通道配置的场景。</p>
          <div className="mode-check-list">
            <span>设备需要插入电脑</span>
            <span>可读取本机串口日志</span>
            <span>可通过 USB 写入离线配置</span>
          </div>
          <button className="mode-enter-button" onClick={(event) => { event.stopPropagation(); selectMode('serial', navigate); }}>进入串口模式</button>
        </div>

        <div className={selected === 'lan' ? 'mode-choice-card lan-choice selected' : 'mode-choice-card lan-choice'} onClick={() => setSelected('lan')}>
          <div className="mode-choice-icon"><Router size={30} /></div>
          <span className="eyebrow">WiFi / 日常管理</span>
          <h2>局域网模式</h2>
          <p>设备需要提前连好 WiFi，并且和当前电脑处于同一局域网。适合大部分日常管理场景，可控制设备配置、AT 命令、OTA、重启等功能。</p>
          <div className="mode-check-list">
            <span>设备需提前已连好 WiFi</span>
            <span>适合批量管理局域网设备</span>
            <span>可执行 EC200M AT 与固件接管</span>
          </div>
          <button className="mode-enter-button" onClick={(event) => { event.stopPropagation(); selectMode('lan', navigate); }}>进入局域网模式</button>
        </div>
      </div>
    </section>
  );
}
