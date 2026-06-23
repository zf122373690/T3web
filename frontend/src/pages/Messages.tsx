import {useEffect, useMemo, useState} from 'react';
import {MessageSquare, PhoneCall, RefreshCw, Search, Trash2} from 'lucide-react';
import {clearMessages, deleteMessage, listMessages, type MessageItem} from '../api/messages';

type RecordMode = 'all' | 'sms' | 'call';

const tabs: Array<{value: RecordMode; label: string}> = [
  {value: 'all', label: '全部'},
  {value: 'sms', label: '短信记录'},
  {value: 'call', label: '通话记录'},
];

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

function directionLabel(value: string) {
  if (value === 'out') return '发出';
  if (value === 'in') return '接收';
  if (value === 'call') return '来电';
  return value || '-';
}

function statusLabel(value: string) {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  return value || '-';
}

function modeTitle(mode: RecordMode) {
  if (mode === 'sms') return '短信记录';
  if (mode === 'call') return '通话记录';
  return '短信和通话记录';
}

export default function Messages() {
  const [items, setItems] = useState<MessageItem[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<RecordMode>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const direction = mode === 'all' ? '' : mode;
  const smsCount = useMemo(() => items.filter((item) => item.direction === 'in' || item.direction === 'out').length, [items]);
  const callCount = useMemo(() => items.filter((item) => item.direction === 'call').length, [items]);

  const load = async (nextMode = mode) => {
    setLoading(true);
    setError('');
    try {
      const data = await listMessages({page: 1, pageSize: 150, search, direction: nextMode === 'all' ? '' : nextMode});
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(mode);
  }, [mode]);

  const remove = async (message: MessageItem) => {
    if (!confirm('删除这条记录？')) return;
    await deleteMessage(message.id);
    setItems((current) => current.filter((item) => item.id !== message.id));
    setTotal((value) => Math.max(0, value - 1));
  };

  const clearCurrent = async () => {
    if (!confirm(`清空${modeTitle(mode)}？`)) return;
    await clearMessages(direction);
    setItems([]);
    setTotal(0);
  };

  return (
    <section className="page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">Signal Archive</span>
          <h1>{modeTitle(mode)}</h1>
          <p>共 {total} 条信号记录，当前列表短信 {smsCount} 条，通话 {callCount} 条。</p>
        </div>
        <button className="secondary-button" onClick={() => load(mode)} disabled={loading}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      <div className="record-tabs" role="tablist" aria-label="记录类型">
        {tabs.map((tab) => (
          <button key={tab.value} className={mode === tab.value ? 'active' : ''} onClick={() => setMode(tab.value)}>
            {tab.value === 'call' ? <PhoneCall size={16} /> : <MessageSquare size={16} />}
            {tab.label}
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void load(mode)}
            placeholder="搜索号码、内容、方向、状态"
          />
        </div>
        <button className="primary-action" onClick={() => load(mode)} disabled={loading}>搜索</button>
        <button className="secondary-button" onClick={clearCurrent} disabled={loading || items.length === 0}>
          <Trash2 size={16} /> 清空
        </button>
      </div>
      {error && <div className="error inline-error">{error}</div>}

      <div className="table-card">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>号码</th>
              <th>类型</th>
              <th>状态</th>
              <th>内容</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="empty">暂无记录。</td></tr>
            ) : items.map((message) => (
              <tr key={message.id}>
                <td>{timeLabel(message.createdAt)}</td>
                <td><code>{message.phone}</code></td>
                <td>{directionLabel(message.direction)}</td>
                <td><span className={message.status === 'success' ? 'status-ok' : 'status-bad'}>{statusLabel(message.status)}</span></td>
                <td className="message-content">{message.content}</td>
                <td className="row-actions">
                  <button title="删除" onClick={() => remove(message)}><Trash2 size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
