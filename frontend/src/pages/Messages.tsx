import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  MessageSquare, Phone, ArrowDownLeft, ArrowUpRight, Trash2,
  RefreshCw, Search, Inbox, PhoneCall, Send, X,
  ChevronLeft, ChevronRight, Download,
} from 'lucide-react';
import {
  CallItem, MessageItem, MessageStats, clearMessages, deleteMessage,
  getMessageStats, listCalls, listMessages, syncDeviceRecords,
} from '../api/messages';
import {listDevices, sendDeviceSms, type DeviceItem} from '../api/devices';

type ViewMode = 'conversations' | 'messages' | 'calls';

interface Conversation {
  key: string;
  phone: string;
  deviceName: string;
  simSlot: string;
  lastContent: string;
  lastTime: number;
  count: number;
  hasCall: boolean;
  messages: MessageItem[];
  calls: CallItem[];
}

function formatTime(ts: number) {
  if (!ts) return '-';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit', hour12: false});
  }
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function formatFullTime(ts: number) {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

function phoneKey(phone: string) {
  return (phone || '').replace(/\D/g, '') || phone || 'unknown';
}

export default function MessagesPage() {
  const [view, setView] = useState<ViewMode>('conversations');
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [calls, setCalls] = useState<CallItem[]>([]);
  const [stats, setStats] = useState<MessageStats>({total: 0, today: 0, week: 0, failed: 0});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [replyDialog, setReplyDialog] = useState<{phone: string; content: string; deviceId: string; simSlot: number} | null>(null);
  const [sending, setSending] = useState(false);
  const pageSize = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [msgData, callData, statsData] = await Promise.all([
        listMessages({page, pageSize, search, direction, deviceId}),
        listCalls({page: 1, pageSize: 200}),
        getMessageStats(),
      ]);
      setMessages(msgData.items);
      setTotal(msgData.total);
      setCalls(callData.items);
      setStats(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [page, search, direction, deviceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    listDevices().then((data) => setDevices(data.items)).catch(() => {});
  }, []);

  const conversations = useMemo(() => {
    const map = new Map<string, Conversation>();

    for (const msg of messages) {
      const key = `${phoneKey(msg.phone)}|${msg.deviceId || ''}|${msg.simSlot || ''}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          phone: msg.phone || '未知号码',
          deviceName: msg.deviceName || msg.deviceId || '-',
          simSlot: msg.simSlot || '',
          lastContent: msg.content || '',
          lastTime: msg.time || msg.createdAt || 0,
          count: 1,
          hasCall: false,
          messages: [msg],
          calls: [],
        });
      } else {
        existing.count += 1;
        existing.messages.push(msg);
        const t = msg.time || msg.createdAt || 0;
        if (t >= existing.lastTime) {
          existing.lastTime = t;
          existing.lastContent = msg.content || '';
        }
      }
    }

    for (const call of calls) {
      const key = `${phoneKey(call.phone)}|${call.deviceId || ''}|${call.simSlot || ''}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          key,
          phone: call.phone || '未知号码',
          deviceName: call.deviceName || call.deviceId || '-',
          simSlot: call.simSlot || '',
          lastContent: '来电记录',
          lastTime: call.createdAt || 0,
          count: 1,
          hasCall: true,
          messages: [],
          calls: [call],
        });
      } else {
        existing.hasCall = true;
        existing.count += 1;
        existing.calls.push(call);
        if ((call.createdAt || 0) >= existing.lastTime) {
          existing.lastTime = call.createdAt || 0;
          existing.lastContent = '来电记录';
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => b.lastTime - a.lastTime);
  }, [messages, calls]);

  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const handleDeviceChange = (value: string) => {
    setDeviceId(value);
    setPage(1);
  };

  const openReply = (phone: string) => {
    const onlineDevices = devices.filter((d) => d.status === 'online');
    setReplyDialog({
      phone,
      content: '',
      deviceId: onlineDevices[0]?.id ? String(onlineDevices[0].id) : '',
      simSlot: 1,
    });
  };

  const handleSendSms = async () => {
    if (!replyDialog) return;
    if (!replyDialog.phone.trim()) { setError('号码不能为空'); return; }
    if (!replyDialog.content.trim()) { setError('内容不能为空'); return; }
    if (!replyDialog.deviceId) { setError('请选择发送设备'); return; }
    setSending(true);
    setError('');
    try {
      await sendDeviceSms(Number(replyDialog.deviceId), {
        phone: replyDialog.phone.trim(),
        content: replyDialog.content.trim(),
        simSlot: replyDialog.simSlot,
      });
      setNotice(`已发送到 ${replyDialog.phone}`);
      setReplyDialog(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确认删除这条短信？')) return;
    try {
      await deleteMessage(id);
      setNotice('已删除');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const handleClear = async () => {
    if (!confirm('确认清空全部短信记录？此操作不可恢复。')) return;
    try {
      await clearMessages();
      setNotice('已清空全部记录');
      setActiveConversation(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空失败');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      const result = await syncDeviceRecords();
      setNotice(result.message || `同步完成：新增 ${result.imported} 条`);
      setPage(1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (activeConversation) {
    const timeline: Array<{type: 'msg' | 'call'; time: number; data: MessageItem | CallItem}> = [
      ...activeConversation.messages.map((m) => ({type: 'msg' as const, time: m.time || m.createdAt || 0, data: m})),
      ...activeConversation.calls.map((c) => ({type: 'call' as const, time: c.createdAt || 0, data: c})),
    ].sort((a, b) => a.time - b.time);

    return (
      <div className="msg-page">
        <div className="msg-chat-panel">
          <div className="msg-chat-header">
            <button className="msg-icon-btn" onClick={() => setActiveConversation(null)} title="返回">
              <ChevronLeft size={18} />
            </button>
            <div className="msg-chat-identity">
              <strong>{activeConversation.phone}</strong>
              <small>
                {activeConversation.deviceName}
                {activeConversation.simSlot ? ` · SIM${activeConversation.simSlot}` : ''}
                {` · ${activeConversation.count} 条`}
              </small>
            </div>
            <button className="msg-btn primary" onClick={() => openReply(activeConversation.phone)} title="回复短信">
              <Send size={14} /> 回复
            </button>
          </div>
          <div className="msg-chat-body">
            {timeline.length === 0 ? (
              <div className="msg-empty-inline">暂无消息</div>
            ) : timeline.map((item) => {
              if (item.type === 'call') {
                const call = item.data as CallItem;
                return (
                  <div key={`call-${call.id}`} className="msg-bubble call">
                    <div className="msg-bubble-meta">
                      <span className="msg-pill call">来电</span>
                      <span className="mono">{formatFullTime(call.createdAt)}</span>
                    </div>
                    <div className="msg-bubble-text muted">来电记录</div>
                  </div>
                );
              }
              const msg = item.data as MessageItem;
              const isOut = msg.direction === 'out';
              return (
                <div key={`msg-${msg.id}`} className={`msg-bubble ${isOut ? 'out' : 'in'}`}>
                  <div className="msg-bubble-meta">
                    <span className={`msg-pill ${isOut ? 'out' : 'in'}`}>{isOut ? '发出' : '收到'}</span>
                    <span className="mono">{formatFullTime(msg.time || msg.createdAt)}</span>
                  </div>
                  <div className="msg-bubble-text">{msg.content || '(空内容)'}</div>
                  <div className="msg-bubble-actions">
                    <button onClick={() => void handleDelete(msg.id)} title="删除">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg-page">
      {(error || notice) && (
        <div className={`msg-notice ${error ? 'err' : 'ok'}`}>
          <span>{error || notice}</span>
          <button onClick={() => { setError(''); setNotice(''); }}>×</button>
        </div>
      )}

      <div className="msg-stats">
        <div className="msg-stat total">
          <div>
            <div className="msg-stat-value">{stats.total}</div>
            <div className="msg-stat-label">总短信</div>
          </div>
        </div>
        <div className="msg-stat today">
          <div>
            <div className="msg-stat-value">{stats.today}</div>
            <div className="msg-stat-label">今日</div>
          </div>
        </div>
        <div className="msg-stat week">
          <div>
            <div className="msg-stat-value">{stats.week}</div>
            <div className="msg-stat-label">本周</div>
          </div>
        </div>
        <div className="msg-stat failed">
          <div>
            <div className="msg-stat-value">{stats.failed}</div>
            <div className="msg-stat-label">失败</div>
          </div>
        </div>
      </div>

      <div className="msg-toolbar">
        <div className="msg-toolbar-left">
          <div className="msg-search-wrap">
            <Search size={15} />
            <input
              className="msg-search"
              placeholder="搜索号码 / 内容 / 设备..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>
          <select
            className="msg-filter"
            value={direction}
            onChange={(e) => { setDirection(e.target.value); setPage(1); }}
          >
            <option value="">全部方向</option>
            <option value="in">仅收到</option>
            <option value="out">仅发出</option>
          </select>
          <select
            className="msg-filter"
            value={deviceId}
            onChange={(e) => handleDeviceChange(e.target.value)}
          >
            <option value="">全部设备</option>
            {devices.map((d) => (
              <option key={d.id} value={d.ip}>{d.name || d.ip}</option>
            ))}
          </select>
        </div>
        <div className="msg-toolbar-right">
          <button className="msg-btn primary" onClick={() => void handleSync()} disabled={syncing || loading}>
            <Download size={14} />
            {syncing ? '同步中…' : '从设备同步'}
          </button>
          <button className="msg-btn" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            刷新
          </button>
          <button className="msg-btn danger" onClick={() => void handleClear()} disabled={loading}>
            <Trash2 size={14} />
            清空
          </button>
        </div>
      </div>

      <div className="msg-tabs">
        <button className={view === 'conversations' ? 'active' : ''} onClick={() => setView('conversations')}>
          会话列表
          <em>{conversations.length}</em>
        </button>
        <button className={view === 'messages' ? 'active' : ''} onClick={() => setView('messages')}>
          全部短信
          <em>{total}</em>
        </button>
        <button className={view === 'calls' ? 'active' : ''} onClick={() => setView('calls')}>
          通话记录
          <em>{calls.length}</em>
        </button>
      </div>

      {loading ? (
        <div className="msg-empty">
          <div className="msg-spinner" />
          <p>加载中…</p>
        </div>
      ) : view === 'conversations' ? (
        conversations.length === 0 ? (
          <div className="msg-empty">
            <div className="msg-empty-icon"><MessageSquare size={40} /></div>
            <p>暂无会话</p>
            <span>可从设备同步短信，或等待新消息上报</span>
            <button className="msg-btn primary" onClick={() => void handleSync()} disabled={syncing}>
              {syncing ? '同步中…' : '从设备同步'}
            </button>
          </div>
        ) : (
          <div className="msg-conv-list">
            {conversations.map((c) => (
              <div key={c.key} className="msg-conv-card-wrap">
                <button className="msg-conv-card" onClick={() => setActiveConversation(c)}>
                  <div className={`msg-conv-avatar ${c.hasCall ? 'call' : ''}`}>
                    {c.hasCall ? <Phone size={16} /> : <MessageSquare size={16} />}
                  </div>
                  <div className="msg-conv-main">
                    <div className="msg-conv-top">
                      <strong className="mono">{c.phone}</strong>
                      {c.simSlot ? <span className="msg-tag">SIM{c.simSlot}</span> : null}
                    </div>
                    <div className="msg-conv-sub mono">{c.deviceName}</div>
                    <div className="msg-conv-preview">{c.lastContent || '(无内容)'}</div>
                  </div>
                  <div className="msg-conv-meta">
                    <span className="mono">{formatTime(c.lastTime)}</span>
                    <em>{c.count}</em>
                  </div>
                </button>
                <button className="msg-conv-reply" onClick={(e) => { e.stopPropagation(); openReply(c.phone); }} title="回复">
                  <Send size={14} />
                </button>
              </div>
            ))}
          </div>
        )
      ) : view === 'messages' ? (
        messages.length === 0 ? (
          <div className="msg-empty">
            <div className="msg-empty-icon"><Inbox size={40} /></div>
            <p>暂无短信记录</p>
            <span>同步设备后将在此显示</span>
          </div>
        ) : (
          <>
            <div className="msg-table-wrap">
              <table className="msg-table">
                <thead>
                  <tr>
                    <th>方向</th>
                    <th>号码</th>
                    <th>内容</th>
                    <th>设备</th>
                    <th>SIM</th>
                    <th>时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((msg) => {
                    const isOut = msg.direction === 'out';
                    return (
                      <tr key={msg.id}>
                        <td>
                          <span className={`msg-dir ${isOut ? 'out' : 'in'}`}>
                            {isOut ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                            {isOut ? '发出' : '收到'}
                          </span>
                        </td>
                        <td className="mono">{msg.phone || '-'}</td>
                        <td className="msg-content-cell">{msg.content || '(空)'}</td>
                        <td className="mono muted">{msg.deviceName || msg.deviceId || '-'}</td>
                        <td>{msg.simSlot ? `SIM${msg.simSlot}` : '-'}</td>
                        <td className="mono muted">{formatFullTime(msg.time || msg.createdAt)}</td>
                        <td>
                          <button className="msg-icon-btn danger" onClick={() => void handleDelete(msg.id)} title="删除">
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="msg-pagination">
              <button className="msg-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft size={14} /> 上一页
              </button>
              <span>{page} / {totalPages} · 共 {total} 条</span>
              <button className="msg-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                下一页 <ChevronRight size={14} />
              </button>
            </div>
          </>
        )
      ) : (
        calls.length === 0 ? (
          <div className="msg-empty">
            <div className="msg-empty-icon"><PhoneCall size={40} /></div>
            <p>暂无通话记录</p>
          </div>
        ) : (
          <div className="msg-table-wrap">
            <table className="msg-table">
              <thead>
                <tr>
                  <th>类型</th>
                  <th>号码</th>
                  <th>设备</th>
                  <th>SIM</th>
                  <th>时间</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td>
                      <span className="msg-dir call">
                        <Phone size={12} /> 来电
                      </span>
                    </td>
                    <td className="mono">{call.phone || '-'}</td>
                    <td className="mono muted">{call.deviceName || call.deviceId || '-'}</td>
                    <td>{call.simSlot ? `SIM${call.simSlot}` : '-'}</td>
                    <td className="mono muted">{formatFullTime(call.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {replyDialog && (
        <div className="msg-reply-overlay" onClick={() => !sending && setReplyDialog(null)}>
          <div className="msg-reply-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="msg-reply-header">
              <strong>回复短信</strong>
              <button className="msg-icon-btn" onClick={() => setReplyDialog(null)} disabled={sending}><X size={16} /></button>
            </div>
            <label className="msg-reply-field">
              <span>号码</span>
              <input className="mono" value={replyDialog.phone} onChange={(e) => setReplyDialog({...replyDialog, phone: e.target.value})} placeholder="接收号码" disabled={sending} />
            </label>
            <label className="msg-reply-field">
              <span>内容</span>
              <textarea rows={4} value={replyDialog.content} onChange={(e) => setReplyDialog({...replyDialog, content: e.target.value})} placeholder="短信内容…" disabled={sending} />
            </label>
            <div className="msg-reply-row">
              <label className="msg-reply-field inline">
                <span>发送设备</span>
                <select value={replyDialog.deviceId} onChange={(e) => setReplyDialog({...replyDialog, deviceId: e.target.value})} disabled={sending}>
                  <option value="">请选择</option>
                  {devices.filter((d) => d.status === 'online').map((d) => (
                    <option key={d.id} value={String(d.id)}>{d.name || d.ip}</option>
                  ))}
                </select>
              </label>
              <label className="msg-reply-field inline">
                <span>SIM 卡槽</span>
                <select value={replyDialog.simSlot} onChange={(e) => setReplyDialog({...replyDialog, simSlot: Number(e.target.value)})} disabled={sending}>
                  <option value={1}>SIM1</option>
                  <option value={2}>SIM2</option>
                </select>
              </label>
            </div>
            {error && <div className="msg-reply-error">{error}</div>}
            <div className="msg-reply-actions">
              <button className="msg-btn" onClick={() => setReplyDialog(null)} disabled={sending}>取消</button>
              <button className="msg-btn primary" onClick={() => void handleSendSms()} disabled={sending}>
                <Send size={14} />
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
