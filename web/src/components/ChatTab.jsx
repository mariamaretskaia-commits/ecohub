import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import PhotoLightbox from './PhotoLightbox';
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
  onReport,
  savingEdit,
  onOpenPhoto,
}) {
  const deleted = Boolean(msg.is_deleted);
  const hasText = Boolean(String(msg.body || '').trim());
  const hasPhoto = Boolean(msg.photo_url);

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
        {deleted ? (
          <p className={`text-sm font-medium italic opacity-70 ${mine ? 'text-white' : 'text-ink/75'}`}>
            Сообщение удалено
          </p>
        ) : (
          <>
            {hasPhoto && (
              <button
                type="button"
                onClick={() => onOpenPhoto?.(msg.photo_url)}
                className="block w-full mb-1.5 overflow-hidden rounded-xl"
              >
                <img
                  src={photoSrc(msg.photo_url)}
                  alt=""
                  className="max-h-56 w-full object-cover"
                />
              </button>
            )}
            {hasText && (
              <p
                className={`text-sm font-medium leading-relaxed whitespace-pre-wrap break-words ${
                  mine ? 'text-white' : 'text-ink/75'
                }`}
              >
                {msg.body}
              </p>
            )}
            {!hasText && !hasPhoto && (
              <p className={`text-sm font-medium italic opacity-70 ${mine ? 'text-white' : 'text-ink/75'}`}>
                Сообщение
              </p>
            )}
          </>
        )}
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
            {hasText && (
              <button
                type="button"
                onClick={() => onStartEdit(msg)}
                className="text-[11px] font-extrabold underline underline-offset-2 text-white/90"
              >
                Изменить
              </button>
            )}
            <button
              type="button"
              onClick={() => onDelete(msg)}
              className="text-[11px] font-extrabold underline underline-offset-2 text-white/90"
            >
              Удалить
            </button>
          </div>
        )}
        {!mine && !deleted && (
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => onReport?.(msg)}
              className="text-[11px] font-extrabold underline underline-offset-2 text-[#b42318]"
            >
              Пожаловаться
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
  onGoToFeed,
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
  const [lightbox, setLightbox] = useState(null);
  const [listMode, setListMode] = useState('outgoing');
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reportConfirm, setReportConfirm] = useState(null);
  const [reporting, setReporting] = useState(false);
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

  const { incomingThreads, outgoingThreads } = useMemo(() => {
    const incoming = [];
    const outgoing = [];
    for (const thread of threads) {
      const role = thread.role
        || (user?.id && Number(thread.owner_id) === Number(user.id) ? 'owner' : 'buyer');
      if (role === 'owner') incoming.push(thread);
      else outgoing.push(thread);
    }
    return { incomingThreads: incoming, outgoingThreads: outgoing };
  }, [threads, user?.id]);

  const activeList = listMode === 'incoming' ? incomingThreads : outgoingThreads;
  const incomingUnread = incomingThreads.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);
  const outgoingUnread = outgoingThreads.reduce((sum, t) => sum + Number(t.unread_count || 0), 0);

  useEffect(() => {
    if (!activeWantId || !threads.length) return;
    const thread = threads.find((t) => Number(t.want_id) === Number(activeWantId));
    if (!thread) return;
    const role = thread.role
      || (user?.id && Number(thread.owner_id) === Number(user.id) ? 'owner' : 'buyer');
    setListMode(role === 'owner' ? 'incoming' : 'outgoing');
  }, [activeWantId, threads, user?.id]);

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

  const handleDeleteMessage = (msg) => {
    setDeleteConfirm({
      kind: 'message',
      id: msg.id,
      title: 'Удалить это сообщение?',
    });
  };

  const handleDeleteThread = (wantId) => {
    setDeleteConfirm({
      kind: 'thread',
      id: wantId,
      title: 'Удалить переписку целиком?',
      text: 'Все сообщения будут удалены. Это нельзя отменить.',
    });
  };

  const cancelDelete = () => {
    if (deleting) return;
    setDeleteConfirm(null);
  };

  const handleReportMessage = (msg) => {
    setReportConfirm({
      id: msg.id,
      text: `Пожаловаться на сообщение ${msg.sender_name ? `${msg.sender_name}: ` : ''}${String(msg.body || '').slice(0, 80)}?`,
    });
  };

  const cancelReport = () => {
    if (reporting) return;
    setReportConfirm(null);
  };

  const confirmReport = async () => {
    if (!reportConfirm || reporting) return;
    setReporting(true);
    try {
      await api.reportChatMessage(reportConfirm.id);
      setReportConfirm(null);
      tg.showAlert('Жалоба отправлена команде EcoHub. Спасибо, что делаете сервис безопаснее.');
    } catch (err) {
      setLoadError(err.message);
      setReportConfirm(null);
    } finally {
      setReporting(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteConfirm || deleting) return;
    setDeleting(true);
    try {
      if (deleteConfirm.kind === 'message') {
        await api.deleteChatMessage(deleteConfirm.id);
        setMessages((prev) => prev.map((m) => (
          m.id === deleteConfirm.id
            ? { ...m, body: null, photo_url: null, is_deleted: true, read_by_peer: false }
            : m
        )));
        if (editingMessageId === deleteConfirm.id) handleCancelEdit();
        await loadThreads();
      } else {
        await api.deleteChatThread(deleteConfirm.id);
        if (Number(activeWantId) === Number(deleteConfirm.id)) {
          setActiveWantId(null);
          setThreadMeta(null);
          setMessages([]);
        }
        await loadThreads();
      }
      setDeleteConfirm(null);
    } catch (err) {
      setLoadError(err.message);
      setDeleteConfirm(null);
    } finally {
      setDeleting(false);
    }
  };

  const closeThread = () => {
    setActiveWantId(null);
    setLightbox(null);
    setThreadMeta(null);
    setMessages([]);
    setEditingMessageId(null);
    setEditText('');
    loadThreads();
  };

  if (!user?.profile_complete) {
    return (
      <div className="px-4 pt-8 text-center">
        <Sticker name="chat" size={72} className="mx-auto mb-3" alt="чат" />
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
            <p className="type-kicker truncate">
              {threadMeta?.role === 'owner' ? 'Отклик ко мне · ' : 'Мой отклик · '}
              {peer}
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleDeleteThread(activeWantId)}
            className="shrink-0 text-xs font-extrabold text-[#b42318] px-2 py-1"
          >
            Удалить чат
          </button>
        </div>

        <div className="mb-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-center">
          <p className="text-[11px] font-extrabold text-amber-800 leading-snug">
            Безопасность: в чате EcoHub запрещены предложения денег, оплаты, наркотиков, оружия и
            чужих документов. Мошенники часто пишут текст на фото или через символы.
          </p>
          <p className="text-[11px] font-bold text-amber-900 mt-1">
            Видите подозрительное сообщение? Нажмите под ним «Пожаловаться» — команда проверит и
            заблокирует нарушителя.
          </p>
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
              Напишите первое сообщение.
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
                  onReport={handleReportMessage}
                  savingEdit={savingEdit}
                  onOpenPhoto={(url) => setLightbox({ photos: [url], index: 0 })}
                />
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        {!threadMeta?.closed && (
          <form onSubmit={handleSend} className="mt-3 flex gap-2 items-end">
            <input
              type="text"
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder="Сообщение…"
              maxLength={2000}
              className="field flex-1"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={sending || !text.trim()}
              className="btn-primary px-4 shrink-0"
            >
              {sending ? '…' : '→'}
            </button>
          </form>
        )}
        {lightbox && (
          <PhotoLightbox
            photos={lightbox.photos}
            index={lightbox.index}
            onClose={() => setLightbox(null)}
            onIndex={(i) => setLightbox((prev) => (prev ? { ...prev, index: i } : null))}
          />
        )}
        <DeleteConfirmDialog
          open={Boolean(deleteConfirm)}
          title={deleteConfirm?.title}
          text={deleteConfirm?.text}
          busy={deleting}
          onCancel={cancelDelete}
          onConfirm={confirmDelete}
        />
        <ReportConfirmDialog
          open={Boolean(reportConfirm)}
          text={reportConfirm?.text}
          busy={reporting}
          onCancel={cancelReport}
          onConfirm={confirmReport}
        />
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="card p-4 mb-4 text-center">
        <Sticker name="chat" size={64} className="mx-auto mb-2" alt="чат" />
        <h2 className="type-title">Чат</h2>
        <p className="type-body mt-1">
          Переписки по объявлениям из{' '}
          <button
            type="button"
            onClick={() => onGoToFeed?.()}
            className="font-extrabold text-mint-700 underline underline-offset-2 decoration-mint-300 active:opacity-70"
          >
            «Даром»
          </button>
          {' '}и{' '}
          <button
            type="button"
            onClick={() => onNeedProfile?.()}
            className="font-extrabold text-mint-700 underline underline-offset-2 decoration-mint-300 active:opacity-70"
          >
            «Мои объявления»
          </button>
          .
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          type="button"
          onClick={() => setListMode('outgoing')}
          className={`relative filter-chip w-full justify-center ${
            listMode === 'outgoing' ? 'filter-chip-active' : 'filter-chip-inactive'
          }`}
        >
          Мои отклики
          {outgoingUnread > 0 && (
            <span
              className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                listMode === 'outgoing' ? 'bg-white/90 text-mint-700' : 'bg-mint-500 text-white'
              }`}
            >
              {outgoingUnread}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setListMode('incoming')}
          className={`relative filter-chip w-full justify-center ${
            listMode === 'incoming' ? 'filter-chip-active' : 'filter-chip-inactive'
          }`}
        >
          Отклики ко мне
          {incomingUnread > 0 && (
            <span
              className={`ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-black ${
                listMode === 'incoming' ? 'bg-white/90 text-mint-700' : 'bg-mint-500 text-white'
              }`}
            >
              {incomingUnread}
            </span>
          )}
        </button>
      </div>

      {loadError && (
        <p className="type-meta text-red-500 text-center mb-3">{loadError}</p>
      )}

      {loading ? (
        <p className="type-body text-center opacity-60 py-8">Загружаем переписки…</p>
      ) : activeList.length === 0 ? (
        <div className="card p-5 text-center">
          <Sticker name="listing" size={72} className="mx-auto mb-2" alt="объявление" />
          <p className="type-title">Пока пусто</p>
          <p className="type-body mt-1">
            {listMode === 'outgoing' ? (
              <>
                Откройте{' '}
                <button
                  type="button"
                  onClick={() => onGoToFeed?.()}
                  className="font-extrabold text-mint-700 underline underline-offset-2 decoration-mint-300 active:opacity-70"
                >
                  «Даром»
                </button>
                {' '}и нажмите «Хочу взять» у объявления.
              </>
            ) : (
              'Когда кто-то нажмёт «Хочу взять» на ваше объявление, переписка появится здесь.'
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeList.map((thread) => (
            <ThreadRow
              key={thread.want_id}
              thread={thread}
              onOpen={() => setActiveWantId(thread.want_id)}
              onDelete={() => handleDeleteThread(thread.want_id)}
            />
          ))}
        </div>
      )}
      <DeleteConfirmDialog
        open={Boolean(deleteConfirm)}
        title={deleteConfirm?.title}
        text={deleteConfirm?.text}
        busy={deleting}
        onCancel={cancelDelete}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function ReportConfirmDialog({ open, text, busy, onCancel, onConfirm }) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-confirm-title"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-sm p-5 text-center shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="report-confirm-title" className="type-title">
          Пожаловаться?
        </p>
        {text && <p className="type-body mt-2 break-words">{text}</p>}
        <p className="type-meta mt-2">
          Жалоба будет отправлена команде EcoHub. Подозреваемого могут заблокировать навсегда.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary w-full">
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full rounded-full bg-[#b42318] px-5 py-2.5 text-sm font-extrabold text-white shadow-soft active:scale-95 transition-transform disabled:opacity-60"
          >
            {busy ? 'Отправляем…' : 'Пожаловаться'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function DeleteConfirmDialog({ open, title, text, busy, onCancel, onConfirm }) {
  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-sm p-5 text-center shadow-float"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="delete-confirm-title" className="type-title">
          {title}
        </p>
        {text && <p className="type-body mt-2">{text}</p>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary w-full"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="w-full rounded-full bg-[#b42318] px-5 py-2.5 text-sm font-extrabold text-white shadow-soft active:scale-95 transition-transform disabled:opacity-60"
          >
            {busy ? 'Удаляем…' : 'Удалить'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ThreadRow({ thread, onOpen, onDelete }) {
  const thumb = threadPhoto(thread);
  return (
    <div className="card flex items-stretch overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOpen?.();
          }
        }}
        className="flex-1 p-3 flex items-center gap-3 text-left active:scale-[0.99] transition-transform min-w-0 cursor-pointer"
      >
        <div className="relative h-14 w-14 rounded-2xl overflow-hidden bg-mint-50 shrink-0 flex items-center justify-center">
          {thumb ? (
            <img src={thumb} alt="" className="h-full w-full object-cover" />
          ) : (
            <Sticker name="listing" size={40} alt="" />
          )}
          {thread.unread_count > 0 && (
            <span
              className="absolute top-1.5 right-1.5 h-3 w-3 rounded-full bg-mint-500 border-2 border-white shadow-sm"
              aria-hidden
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            {thread.unread_count > 0 && (
              <span
                className="shrink-0 h-2.5 w-2.5 rounded-full bg-mint-500"
                aria-label="Непрочитанные сообщения"
              />
            )}
            <p className={`type-title truncate ${thread.unread_count > 0 ? 'text-ink' : ''}`}>
              {thread.title}
            </p>
          </div>
          <p className="type-kicker truncate">{thread.peer_name}</p>
          <p className={`type-meta truncate mt-0.5 ${thread.unread_count > 0 ? 'text-ink/70 font-extrabold' : 'opacity-70'}`}>
            {thread.last_body || (thread.closed ? 'Вещь отдана' : 'Нет сообщений')}
          </p>
        </div>
        {thread.last_at && (
          <span className="type-kicker shrink-0 opacity-50 self-start">
            {formatTime(thread.last_at)}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onDelete?.();
        }}
        className="relative z-10 shrink-0 px-3 text-[11px] font-extrabold text-[#b42318] border-l border-mint-100 active:bg-red-50 touch-manipulation"
        aria-label="Удалить чат"
      >
        Удалить
      </button>
    </div>
  );
}
