import { useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import { isForbiddenNickname, NICK_ABUSE_MESSAGE } from '../moderation';

const NICK_RE = /^[А-Яа-яЁёІіЎў''\- ]{2,50}$/;

function normalizeNickname(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isCyrillicNickname(raw) {
  const name = normalizeNickname(raw);
  return NICK_RE.test(name) && /[А-Яа-яЁёІіЎў]/.test(name);
}

export default function ProfileForm({ user, onSaved, onBrowseMap, intro }) {
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [consent, setConsent] = useState(Boolean(user?.consent_at));
  const [loading, setLoading] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const name = normalizeNickname(nickname);
    if (!isCyrillicNickname(name)) {
      tg.showAlert('Имя только кириллицей, до 50 символов. Например: Марья Марецкая');
      return;
    }
    if (isForbiddenNickname(name)) {
      tg.showAlert(NICK_ABUSE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      await api.saveProfile({ nickname: name, consent: consent || Boolean(user?.consent_at) });
      await onSaved?.();
    } catch (err) {
      tg.showAlert(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="px-4 pt-2 pb-28">
      {intro && (
        <div className="card p-5 mb-4 bg-gradient-to-br from-mint-100 to-sun-50 text-center">
          <Sticker name="person" size={72} className="mx-auto" alt="профиль" />
          <h2 className="type-brand mt-2">Ваш профиль</h2>
          <p className="type-body mt-2">
            Укажите, как к Вам обращаться. Это имя будут видеть остальные пользователи. Например: Марья Марецкая
          </p>
          <p className="type-meta mt-2">
            Профиль привязан к этому Telegram: один аккаунт – один профиль в EcoHub.
          </p>
        </div>
      )}

      <form onSubmit={save} className="card p-5 space-y-3">
        <label className="block">
          <span className="type-label">Как к Вам обращаться *</span>
          <input
            className="field"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Марья Марецкая"
            autoComplete="nickname"
            maxLength={50}
          />
        </label>
        {!user?.consent_at && (
          <label className="flex gap-2 items-start pt-1">
            <input
              type="checkbox"
              className="mt-1"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span className="type-meta">
              Согласен, что это имя увидят другие пользователи EcoHub.
            </span>
          </label>
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Сохраняем…' : 'Сохранить'}
        </button>
      </form>

      {onBrowseMap && (
        <button type="button" onClick={onBrowseMap} className="w-full mt-4 type-kicker">
          Пока только карта – без объявлений
        </button>
      )}
    </div>
  );
}
