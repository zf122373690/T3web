import {useEffect, useState} from 'react';
import {DownloadCloud, RefreshCw, Rocket} from 'lucide-react';
import {
  checkSelfUpdate,
  getSelfUpdateStatus,
  runSelfUpdate,
  type SelfUpdateState,
  type SystemVersionInfo,
} from '../api/devices';

function sizeLabel(size?: number) {
  if (!size) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function SelfUpdateBar({versionInfo}: {versionInfo?: SystemVersionInfo | null}) {
  const [state, setState] = useState<SelfUpdateState | null>(versionInfo?.selfUpdate || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (versionInfo?.selfUpdate) setState(versionInfo.selfUpdate);
  }, [versionInfo]);

  useEffect(() => {
    let timer: number | undefined;
    const running = state?.status === 'downloading' || state?.status === 'applying' || state?.status === 'restarting';
    if (!running) return;
    timer = window.setInterval(() => {
      void getSelfUpdateStatus()
        .then(setState)
        .catch(() => undefined);
    }, 1200);
    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [state?.status]);

  const onCheck = async () => {
    setBusy(true);
    setError('');
    try {
      setState(await checkSelfUpdate());
    } catch (err) {
      setError(err instanceof Error ? err.message : '检测失败');
    } finally {
      setBusy(false);
    }
  };

  const onUpgrade = async (force = false) => {
    if (!force && !window.confirm('确认从网盘下载并升级本地助手？升级后程序会自动重启。')) return;
    if (force && !window.confirm('将强制重新下载网盘 EXE 并替换当前程序，是否继续？')) return;
    setBusy(true);
    setError('');
    try {
      const next = await runSelfUpdate(force, true);
      setState(next);
      if (next.status === 'restarting') {
        window.setTimeout(() => {
          window.location.reload();
        }, 4000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '升级失败');
    } finally {
      setBusy(false);
    }
  };

  const statusText = state?.message || '可从网盘检测并升级本地助手';
  const cloudText = `${state?.cloudBase || versionInfo?.cloudBase || 'https://cloud.1992418.xyz'}${state?.cloudDir || versionInfo?.cloudDir || '/T3'}`;

  return (
    <div className="self-update-bar">
      <div className="self-update-main">
        <div className="self-update-title">
          <span>助手升级</span>
          <code>{cloudText}</code>
        </div>
        <div className="self-update-meta">
          <span>本地 {state?.localVersion || versionInfo?.localVersion || '-'}</span>
          <span>网盘 {state?.remoteVersion || '-'}</span>
          <span>{state?.packageName ? `${state.packageName} · ${sizeLabel(state.packageSize)}` : '未检测'}</span>
          {typeof state?.progress === 'number' && state.status === 'downloading' ? <span>进度 {state.progress}%</span> : null}
        </div>
        <div className={`self-update-msg ${state?.hasUpdate ? 'has-update' : ''} ${state?.status === 'error' ? 'is-error' : ''}`}>
          {error || state?.error || statusText}
        </div>
      </div>
      <div className="self-update-actions">
        <button className="btn-secondary" onClick={() => void onCheck()} disabled={busy}>
          <RefreshCw size={14} /> 检测更新
        </button>
        <button className="btn-primary" onClick={() => void onUpgrade(false)} disabled={busy || (!!state && !state.hasUpdate && state.status !== 'downloaded')}>
          <Rocket size={14} /> 下载并升级
        </button>
        <button className="btn-secondary" onClick={() => void onUpgrade(true)} disabled={busy} title="忽略版本比较，强制下载替换">
          <DownloadCloud size={14} /> 强制更新
        </button>
      </div>
    </div>
  );
}
