import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Sticker from './Sticker';
import { photoSrc } from '../photos';

function formatTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function threadPhoto(thread) {
  if (thread.photo_url) return photoSrc(thread.photo_url);
  try {
    const list = typeof thread.photos === 'string' ? JSON.parse(thread.photos) : thread.photos;
    if (Array.isArray(list) && list[0]) return photoSrc(list[0]);
  } catch {
    /* ignore */
  }
  return null;
}

function MessageBubble({
  msg,
  mine,
  editing,
  editText,
  onEditText,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  savingEdit,
}) {
  const deleted = Boolean(msg.is_deleted);

  if (editing) {
    return (
      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
        <form
          onSubmit={onSaveEdit}
          className="max-w-[85%] w-full space-y-2"
        >
          <input
            type="text"
            value={editText}
            onChange={(e) => onEditText(e.target.value)}
            className="field w-full"
            maxLength={2000}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onCancelEdit} className="btn-secondary px-3 py-1.5 text-xs">
              Отмена
            </button>
            <button type="submit" disabled={savingEdit || !editText.trim()} className="btn-primary px-3 py-1.5 text-xs">
              {savingEdit ? '…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 ${
          mine
            ? 'bg-mint-600 text-white rounded-br-md'
            : 'bg-mint-50 text-ink rounded-bl-md border border-mint-100'
        }`}
      >
        {!mine && (
          <p className="text-[11px] font-extrabold opacity-70 mb-0.5">{msg.sender_name}</p>
        )}
        <p
          className={`text-sm font-medium leading-relaxed whitespace-pre-wrap break-words ${
            deleted
              ? 'italic opacity-70'
              : mine
                ? 'text-white'
                : 'text-ink/75'
          }`}
        >
          {deleted ? 'Сообщение удалено' : msg.body}
        </p>
        <div className={`flex items-center gap-2 mt-1 flex-wrap ${mine ? 'justify-end' : ''}`}>
          <p className={`text-[10px] ${mine ? 'text-white/75' : 'text-ink/45'}`}>
            {formatTime(msg.created_at)}
            {msg.edited_at && !deleted && (
              <span className="ml-1 opacity-80">· изменено</span>
            )}
          </p>
          {mine && !deleted && (
            <p className={`text-[10px] font-bold ${msg.read_by_peer ? 'text-white' : 'text-white/60'}`}>
              {msg.read_by_peer ? 'Прочитано' : 'Доставлено'}
            </p>
          )}
        </div>
        {mine && !deleted && (
          <div className="flex gap-2 mt-2 justify-end">
            <button
              type="button"
              onClick={() => onStartEdit(msg)}
              className="text-[11px] font-extrabold underline underline-offset-2 text-white/90"
            >
              Изменить
            </button>
            <button
              type="button"
              onClick={() => onDelete(msg)}
              className="text-[11px] font-extrabold underline underline-offset-2 text-white/90"
            >
              Удалить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatTab({
  user,
  initialWantId,
  onInitialWantHandled,
  onUnreadChange,
  onNeedProfile,
}) {
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeWantId, setActiveWantId] = useState(null);
  const [threadMeta, setThreadMeta] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editText, setEditText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const bottomRef = useRef(null);

  const loadThreads = useCallback(async () => {
    try {
      const data = await api.getChatThreads();
      const list = Array.isArray(data) ? data : [];
      setThreads(list);
      const unread = list.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
      onUnreadChange?.(unread);
      setLoadError(null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }, [onUnreadChange]);

  const loadMessages = useCallback(async (wantId, silent = false) => {
    try {
      const data = await api.getChatMessages(wantId);
      setThreadMeta(data);
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      setLoadError(null);
      if (!silent) await loadThreads();
    } catch (e) {
      if (!silent) setLoadError(e.message);
    }
  }, [loadThreads]);

  useEffect(() => {
    if (!user?.profile_complete) return undefined;
    loadThreads();
    const t = setInterval(loadThreads, 15000);
    return () => clearInterval(t);
  }, [user?.profile_complete, loadThreads]);

  useEffect(() => {
    if (!initialWantId || !user?.profile_complete) return;
    setActiveWantId(Number(initialWantId));
    onInitialWantHandled?.();
  }, [initialWantId, user?.profile_complete, onInitialWantHandled]);

  useEffect(() => {
    if (!activeWantId || !user?.profile_complete) return undefined;
    loadMessages(activeWantId);
    const t = setInterval(() => loadMessages(activeWantId, true), 4000);
    return () => clearInterval(t);
  }, [activeWantId, user?.profile_complete, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, activeWantId]);

  const handleSend = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || sending || !activeWantId || threadMeta?.closed) return;
    setSending(true);
    try {
      const msg = await api.sendChatMessage(activeWantId, body);
      setText('');
      setMessages((prev) => [...prev, msg]);
      await loadThreads();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleStartEdit = (msg) => {
    setEditingMessageId(msg.id);
    setEditText(msg.body || '');
  };

  const handleCancelEdit = () => {
    setEditingMessageId(null);
    setEditText('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    const body = editText.trim();
    if (!body || !editingMessageId || savingEdit) return;
    setSavingEdit(true);
    try {
      const updated = await api.editChatMessage(editingMessageId, body);
      setMessages((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingMessageId(null);
      setEditText('');
      await loadThreads();
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteMessage = async (msg) => {
    if (!confirm('Удалить это сообщение?')) return;
    try {
      await api.deleteChatMessage(msg.id);
      setMessages((prev) => prev.map((m) => (
        m.id === msg.id
          ? { ...m, body: null, is_deleted: true, read_by_peer: false }
          : m
      )));
      if (editingMessageId === msg.id) handleCancelEdit();
      await loadThreads();
    } catch (err) {
      setLoadError(err.message);
    }
  };

  const handleDeleteThread = async (wantId) => {
    if (!confirm('Удалить переписку целиком? Все сообщения будут удалены.')) return;
    try {
      await api.deleteChatThread(wantId);
      if (Number(activeWantId) === Number(wantId)) {
        setActiveWantId(null);
        setThreadMeta(null);
        setMessages([]);
      }
      await loadThreads();
    } catch (err) {
      setLoadError(err.message);
    }
  };

  const closeThread = () => {
    setActiveWantId(null);
    setThreadMeta(null);
    setMessages([]);
    setEditingMessageId(null);
    setEditText('');
    loadThreads();
  };

  if (!user?.profile_complete) {
    return (
      <div className="px-4 pt-8 text-center">
        <Sticker name="phone" size={72} className="mx-auto mb-3" alt="чат" />
        <p className="type-title">Сначала укажите имя</p>
        <p className="type-body mt-2">Откройте «Профиль» и сохраните, как к Вам обращаться – тогда можно переписываться.</p>
        <button type="button" onClick={onNeedProfile} className="btn-primary mt-4 px-6">
          Перейти в профиль
        </button>
      </div>
    );
  }

  if (activeWantId) {
    const activeThread = threads.find((t) => Number(t.want_id) === Number(activeWantId));
    const title = threadMeta?.title || activeThread?.title || 'Переписка';
    const peer = threadMeta?.peer_name || activeThread?.peer_name || 'Собеседник';

    return (
      <div className="px-4 pb-4 flex flex-col min-h-[60vh]">
        <div className="card p-3 flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={closeThread}
            className="btn-secondary px-3 py-2 shrink-0"
          >
            ← Назад
          </button>
          <div className="min-w-0 flex-1">
            <p className="type-title truncate">{title}</p>
            <p className="type-kicker truncate">{peer}</p>
          </div>
          <button
            type="button"
            onClick={() => handleDeleteThread(activeWantId)}
            className="shrink-0 text-xs font-extrabold text-[#b42318] px-2 py-1"
          >
            Удалить чат
          </button>
        </div>

        {threadMeta?.closed && (
          <p className="type-meta text-center mb-3 px-2">
            Переписка закрыта: автор отметил вещь как отданную.
          </p>
        )}

        {loadError && (
          <p className="type-meta text-red-500 text-center mb-2">{loadError}</p>
        )}

        <div className="card flex-1 p-3 overflow-y-auto max-h-[min(52vh,480px)] space-y-3">
          {messages.length === 0 ? (
            <p className="type-body text-center opacity-60 py-8">
              Напишите первое сообщение – собеседник получит уведомление в Telegram.
            </p>
          ) : (
            messages.map((msg) => {
              const mine = Number(msg.sender_id) === Number(user.id);
              return (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  mine={mine}
                  editing={editingMessageId === msg.id}
                  editText={editText}
                  onEditText={setEditText}
                  onStartEdit={handleStartEdit}
                  onCancelEdit={handleCancelEdit}
                  onSaveEdit={handleSaveEdit}
                  onDelete={handleDeleteMessage}
                  savingEdit={savingEdit}
                />
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {!threadMeta?.closed && (
          <form onSubmit={handleSend} className="mt-3 flex gap-2">
            <input
              type="text"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder="Сообщение…"
              maxLength={2000}
              className="field flex-1"
              autoComplete="off"
            />
            <button type="submit" disabled={sending || !text.trim()} className="btn-primary px-4 shrink-0">
              {sending ? '…' : '→'}
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="card p-4 mb-4 text-center">
        <Sticker name="phone" size={64} className="mx-auto mb-2" alt="чат" />
        <h2 className="type-title">Чат</h2>
        <p className="type-body mt-1">
          Переписка по объявлениям – здесь, в приложении. Если вы не в приложении, бот напомнит о новых сообщениях.
        </p>
      </div>

      {loadError && (
        <p className="type-meta text-red-500 text-center mb-3">{loadError}</p>
      )}

      {loading ? (
        <p className="type-body text-center opacity-60 py-8">Загружаем переписки…</p>
      ) : threads.length === 0 ? (
        <div className="card p-5 text-center">
          <Sticker name="listing" size={72} className="mx-auto mb-2" alt="объявление" />
          <p className="type-body">Пока нет переписок.</p>
          <p className="type-kicker mt-2">
            Нажмите «Хочу взять» в ленте «Даром» – чат откроется автоматически.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((thread) => {
            const thumb = threadPhoto(thread);
            return (
              <div key={thread.want_id} className="card flex items-stretch overflow-hidden">
                <button
                  type="button"
                  onClick={() => setActiveWantId(thread.want_id)}
                  className="flex-1 p-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform min-w-0"
                >
                  <div className="h-14 w-14 rounded-2xl overflow-hidden bg-mint-50 shrink-0 flex items-center justify-center">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Sticker name="listing" size={40} alt="" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="type-title truncate">{thread.title}</p>
                      {thread.unread_count > 0 && (
                        <span className="shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-mint-600 text-white text-xs font-extrabold flex items-center justify-center">
                          {thread.unread_count > 99 ? '99+' : thread.unread_count}
                        </span>
                      )}
                    </div>
                    <p className="type-kicker truncate">{thread.peer_name}</p>
                    <p className="type-meta truncate mt-0.5 opacity-70">
                      {thread.last_body || (thread.closed ? 'Вещь отдана' : 'Нет сообщений')}
                    </p>
                  </div>
                  {thread.last_at && (
                    <span className="type-kicker shrink-0 opacity-50 self-start">
                      {formatTime(thread.last_at)}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteThread(thread.want_id)}
                  className="shrink-0 px-3 text-[11px] font-extrabold text-[#b42318] border-l border-mint-100 active:bg-red-50"
                  aria-label="Удалить чат"
                >
                  Удалить
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
