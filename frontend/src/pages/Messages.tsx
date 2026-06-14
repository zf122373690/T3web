import {useEffect, useState} from 'react';
import {RefreshCw, Search, Trash2} from 'lucide-react';
import {clearMessages, deleteMessage, listMessages, type MessageItem} from '../api/messages';

function timeLabel(value: number) {
  return value ? new Date(value * 1000).toLocaleString('zh-CN') : '-';
}

function directionLabel(value: string) {
  if (value === 'out') return '发出';
  if (value === 'in') return '接收';
  return value || '-';
}

function statusLabel(value: string) {
  if (value === 'success') return '成功';
  if (value === 'failed') return '失败';
  return value || '-';
}

export default function Messages() {
  const [items, setItems] = useState<MessageItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listMessages({page: 1, pageSize: 100, search});
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const remove = async (message: MessageItem) => {
    if (!confirm('删除这条短信记录？')) return;
    await deleteMessage(message.id);
    setItems((current) => current.filter((item) => item.id !== message.id));
    setTotal((value) => Math.max(0, value - 1));
  };

  const clearAll = async () => {
    if (!confirm('清空全部短信记录？')) return;
    await clearMessages();
    setItems([]);
    setTotal(0);
  };

  return (
    <section className="page">
      <div className="page-header">
        <div>
          <h1>短信记录</h1>
          <p>共 {total} 条记录，包含设备发送结果和后续接入的接收记录。</p>
        </div>
        <button className="secondary-button" onClick={load} disabled={loading}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      <div className="toolbar">
        <div className="search-field">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void load()} placeholder="搜索号码、内容、状态" />
        </div>
        <button className="primary-action" onClick={load} disabled={loading}>搜索</button>
        <button className="secondary-button" onClick={clearAll} disabled={loading || items.length === 0}>
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
              <th>方向</th>
              <th>状态</th>
              <th>内容</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={6} className="empty">暂无短信记录。</td></tr>
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
