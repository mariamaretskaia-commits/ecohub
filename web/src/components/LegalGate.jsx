import { useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import BrandMark from './BrandMark';
import LegalScreen from './LegalScreen';

export default function LegalGate({ onDone }) {
  const [seen, setSeen] = useState({ rules: false, privacy: false });
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const allSeen = seen.rules && seen.privacy;

  const agree = async () => {
    if (!allSeen || loading) return;
    setLoading(true);
    setError('');
    try {
      await api.acceptLegal();
      await onDone?.();
    } catch (err) {
      setError(err.message || 'Не удалось сохранить согласие. Попробуйте ещё раз.');
      setLoading(false);
    }
  };

  return (
    <div className="px-4 pt-6 pb-10">
      {doc && (
        <LegalScreen
          docId={doc}
          onClose={() => setDoc(null)}
          onAgree={() => {
            setSeen((v) => ({ ...v, [doc]: true }));
            setDoc(null);
          }}
        />
      )}

      <div className="card p-5 text-center bg-gradient-to-b from-white to-mint-50">
        <Sticker name="logo" size={88} className="mx-auto" />
        <h2 className="type-brand mt-3 leading-tight">Обновлены условия</h2>
        <p className="type-body mt-2">
          Перед продолжением ознакомьтесь с Правилами сообщества и политикой обработки персональных данных и
          согласитесь с ними. Это займёт пару минут.
        </p>

        <div className="mt-4 space-y-2 text-left">
          <DocRow
            title="Правила сообщества EcoHub"
            sub="Пользовательское соглашение"
            seen={seen.rules}
            onClick={() => setDoc('rules')}
          />
          <DocRow
            title="Политика обработки персональных данных"
            sub="РБ, Закон № 99-З"
            seen={seen.privacy}
            onClick={() => setDoc('privacy')}
          />
        </div>

        {error && <p className="type-kicker text-red-500 mt-3">{error}</p>}

        <button
          type="button"
          disabled={!allSeen || loading}
          className="btn-primary mt-5 w-full disabled:opacity-40"
          onClick={agree}
        >
          {loading ? 'Сохраняем…' : 'Я согласен с условиями'}
        </button>
        <button type="button" className="btn-secondary mt-3 w-full" onClick={() => tg.close()}>
          Не согласен – выйти
        </button>

        <p className="type-kicker mt-6 opacity-40 tracking-wide">© 2026</p>
      </div>
    </div>
  );
}

function DocRow({ title, sub, seen, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 rounded-2xl border border-mint-200/70 bg-mint-50/60 px-4 py-3 active:bg-mint-100/70 transition-colors"
    >
      <Sticker name="info" size={30} alt="" />
      <span className="min-w-0 flex-1 text-left">
        <span className="type-title block truncate">{title}</span>
        <span className="type-kicker block">{sub}</span>
      </span>
      {seen ? (
        <span className="shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-mint-500 text-white text-sm font-black">
          ✓
        </span>
      ) : (
        <span className="ml-auto shrink-0 text-mint-700 text-xl font-black" aria-hidden>›</span>
      )}
    </button>
  );
}