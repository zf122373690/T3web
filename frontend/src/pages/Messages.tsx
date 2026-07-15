import {useEffect, useMemo, useState} from 'react';
import {ArrowLeft, MessageSquare, Phone, RefreshCw, Search, Trash2, X} from 'lucide-react';
import {listMessages, deleteMessage, type MessageItem} from '../api/messages';

type RecordMode = 'all' | 'sms' | 'call';

const tabs: Array<{value: RecordMode; label: string; icon: typeof MessageSquare}> = [
  {value: 'all', label: '全部', icon: MessageSquare},
  {value: 'sms', label: '短信', icon: MessageSquare},
  {value: 'call', label: '通话', icon: Phone},
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

function isCall(item: MessageItem) {
  return item.direction === 'call';
}

export default function Messages() {
  const [items, setItems] = useState<MessageItem[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<RecordMode>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);

  // Chat mode state
  const [chatPhone, setChatPhone] = useState<string | null>(null);

  // Grouped conversations
  const conversations = useMemo(() => {
    const filtered = items.filter((item) => {
      if (mode === 'sms' && isCall(item)) return false;
      if (mode === 'call' && !isCall(item)) return false;
      if (search) {
        const q = search.toLowerCase();
        return item.phone.toLowerCase().includes(q) || item.content.toLowerCase().includes(q);
      }
      return true;
    });

    const groups: Record<string, MessageItem[]> = {};
    for (const item of filtered) {
      const key = item.phone;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    // Sort groups by latest message time
    const sorted = Object.entries(groups).sort((a, b) => {
      const lastA = a[1][a[1].length - 1]?.createdAt || 0;
      const lastB = b[1][b[1].length - 1]?.createdAt || 0;
      return lastB - lastA;
    });
    return sorted;
  }, [items, mode, search]);

  const currentConversation = useMemo<[string, MessageItem[]] | null>(() => {
    if (!chatPhone) return null;
    const filtered = items.filter((item) => {
      if (item.phone !== chatPhone) return false;
      if (mode === 'sms' && isCall(item)) return false;
      if (mode === 'call' && !isCall(item)) return false;
      return true;
    }).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return [chatPhone, filtered];
  }, [chatPhone, items, mode]);

  const load = async (nextMode = mode) => {
    setLoading(true);
    setError('');
    try {
      const data = await listMessages({page: 1, pageSize: 200, search, direction: nextMode === 'all' ? '' : nextMode});
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
    if (!confirm(`清空${mode === 'all' ? '所有记录' : mode === 'sms' ? '短信记录' : '通话记录'}？`)) return;
    const dir = mode === 'all' ? '' : mode;
    try {
      await clearMessages(dir);
      setItems([]);
      setTotal(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败');
    }
  };

  return (
    <section className="page messages-page">
      <div className="page-hero">
        <div>
          <span className="eyebrow">Signal Archive</span>
          <h1>{mode === 'all' ? '短信和通话记录' : mode === 'sms' ? '短信记录' : '通话记录'}</h1>
          <p>共 {total} 条信号记录。</p>
        </div>
        <button className="secondary-button" onClick={() => load(mode)} disabled={loading}>
          <RefreshCw size={16} /> 刷新
        </button>
      </div>

      <div className="record-tabs" role="tablist" aria-label="记录类型">
        {tabs.map((tab) => (
          <button key={tab.value} className={mode === tab.value ? 'active' : ''} onClick={() => { setMode(tab.value); setChatPhone(null); }}>
            <tab.icon size={16} />
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
            placeholder="搜索号码或内容"
          />
        </div>
        <button className="primary-action" onClick={() => load(mode)} disabled={loading}>搜索</button>
        <button className="secondary-button" onClick={clearCurrent} disabled={loading || items.length === 0}>
          <Trash2 size={16} /> 清空
        </button>
      </div>
      {error && <div className="error inline-error">{error}</div>}

      {currentConversation ? (
        /* Chat view */
        <div className="messages-chat-view">
          <div className="messages-chat-header">
            <button className="secondary-button" onClick={() => setChatPhone(null)}>
              <ArrowLeft size={14} /> 返回
            </button>
            <div className="messages-chat-title">
              {currentConversation[1].length > 0 && isCall(currentConversation[1][0]) ? <Phone size={15} /> : <MessageSquare size={15} />}
              <strong>{currentConversation[0]}</strong>
            </div>
          </div>
          <div className="messages-chat-body">
            {currentConversation[1].map((msg: MessageItem) => (
              <div key={msg.id} className={`messages-bubble ${isCall(msg) ? 'call-bubble' : msg.direction === 'in' ? 'bubble-in' : 'bubble-out'}`}>
                <div className="messages-bubble-meta">
                  <span className="messages-bubble-time">{timeLabel(msg.createdAt)}</span>
                  {!isCall(msg) && <span className="messages-bubble-dir">{directionLabel(msg.direction)}</span>}
                  {isCall(msg) && <span className="messages-bubble-call">来电</span>}
                </div>
                {isCall(msg) ? (
                  <div className="messages-bubble-call-content">通话记录</div>
                ) : (
                  <div className="messages-bubble-content">{msg.content}</div>
                )}
                <div className="messages-bubble-actions">
                  <button onClick={() => remove(msg)} title="删除"><X size={12} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Conversation list */
        <div className="messages-conversations">
          {conversations.length === 0 ? (
            <div className="empty">暂无记录。</div>
          ) : conversations.map(([phone, msgs]) => {
            const latest = msgs[msgs.length - 1];
            return (
              <button key={phone} className="messages-conversation-card" onClick={() => setChatPhone(phone)}>
                <div className="messages-conversation-icon">
                  {msgs.some(isCall) ? <Phone size={16} /> : <MessageSquare size={16} />}
                </div>
                <div className="messages-conversation-main">
                  <strong>{phone}</strong>
                  <span className="messages-conversation-preview">
                    {isCall(latest) ? '来电' : latest.content.slice(0, 40)}
                  </span>
                </div>
                <div className="messages-conversation-meta">
                  <span>{timeLabel(latest.createdAt)}</span>
                  <span className="messages-conversation-count">{msgs.length} 条</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
