import {useEffect, useState} from 'react';
import {Phone, RefreshCw, Trash2} from 'lucide-react';
import {listCalls, deleteCall, type CallItem} from '../api/messages';

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

function durationLabel(seconds?: number) {
  if (!seconds || seconds <= 0) return '-';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} 分 ${s} 秒` : `${s} 秒`;
}

export default function Calls() {
  const [items, setItems] = useState<CallItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listCalls({page: 1, pageSize: 150});
      if ('items' in data) {
        setItems(data.items);
        setTotal(data.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const remove = async (call: CallItem) => {
    if (!confirm('删除这条通话记录？')) return;
    await deleteCall(call.id);
    setItems((current) => current.filter((item) => item.id !== call.id));
    setTotal((value) => Math.max(0, value - 1));
  };

  const clearAll = async () => {
    if (!confirm('清空所有通话记录？')) return;
    await listCalls({clear: true});
    setItems([]);
    setTotal(0);
  };

  return (
    <section className="page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">Call Archive</span>
          <h1>通话记录</h1>
          <p>共 {total} 条来电记录。</p>
        </div>
        <div style={{display: 'flex', gap: 6}}>
          <button className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={16} /> 刷新</button>
          <button className="secondary-button" onClick={clearAll} disabled={loading || items.length === 0}><Trash2 size={16} /> 清空</button>
        </div>
      </div>

      {error && <div className="error inline-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>号码</th>
              <th>时长</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4} className="empty">暂无通话记录。</td></tr>
            ) : items.map((call) => (
              <tr key={call.id}>
                <td>{timeLabel(call.createdAt)}</td>
                <td><code>{call.phone}</code></td>
                <td>{durationLabel(call.duration)}</td>
                <td className="row-actions">
                  <button title="删除" onClick={() => remove(call)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
