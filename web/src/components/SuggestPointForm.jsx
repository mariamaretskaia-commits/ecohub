import { useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { ACCESS_MODES } from '../point-access';

export default function SuggestPointForm({ onClose }) {
  const [access, setAccess] = useState('');
  const [address, setAddress] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (busy || done) return;
    if (!access) {
      setError('Выберите тип пункта');
      return;
    }
    if (!address.trim()) {
      setError('Укажите адрес');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.suggestPoint({
        type: access,
        address: address.trim(),
        contact: contact.trim(),
      });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Не удалось отправить предложение');
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Предложить пункт"
      onClick={() => { if (!busy) onClose(); }}
    >
      <div
        className="card w-full max-w-sm p-5 shadow-float max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <div className="text-center py-4">
            <p className="type-title mb-2">Спасибо!</p>
            <p className="type-body">
              Предложение отправлено администратору напрямую. Оно появится на карте после проверки.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="btn-primary w-full mt-5"
            >
              Отлично
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <p className="type-title mb-1">Предложить пункт</p>
            <p className="type-meta mb-3">
              Расскажите о пункте, которого нет на карте. Предложение придёт администратору лично и будет проверено.
            </p>

            <p className="type-label mb-1.5">Тип пункта</p>
            <div className="space-y-2 mb-3">
              {Object.entries(ACCESS_MODES).map(([key, val]) => {
                const active = access === key;
                return (
                  <button
                    type="button"
                    key={key}
                    onClick={() => { setAccess(key); setError(''); }}
                    aria-pressed={active}
                    className={`w-full card p-3 text-left flex items-start gap-2 ${active ? 'ring-2 ring-mint-400' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="type-title text-sm">{val.label}</p>
                      <p className="type-kicker mt-0.5">{val.text}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            <label className="type-label block mb-1.5" htmlFor="suggest-address">Адрес</label>
            <textarea
              id="suggest-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Например: г. Гродно, ул. Советская, 10"
              rows={2}
              className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm mb-3"
            />

            <label className="type-label block mb-1.5" htmlFor="suggest-contact">
              Контакт (необязательно)
            </label>
            <input
              id="suggest-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Телефон или Telegram"
              className="w-full rounded-2xl border border-black/10 bg-white px-3 py-2.5 text-sm mb-3"
            />

            {error && <p className="type-kicker text-red-500 mb-2">{error}</p>}

            <button
              type="submit"
              disabled={busy}
              className="btn-primary w-full"
            >
              {busy ? 'Отправляем…' : 'Отправить'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn-secondary w-full mt-2 opacity-70"
            >
              Отмена
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}