import { useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import BrandMark from './BrandMark';
import LegalScreen from './LegalScreen';
import { isForbiddenNickname, NICK_ABUSE_MESSAGE } from '../moderation';

const NICK_RE = /^[А-Яа-яЁёІіЎў''\- ]{2,50}$/;

function normalizeNickname(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ');
}

function isCyrillicNickname(raw) {
  const name = normalizeNickname(raw);
  return NICK_RE.test(name) && /[А-Яа-яЁёІіЎў]/.test(name);
}

export default function ProfileForm({ user, onSaved, intro, compact = false, onCancel }) {
  const [nickname, setNickname] = useState(user?.nickname || '');
  const [consent, setConsent] = useState(Boolean(user?.consent_at));
  const [termsRules, setTermsRules] = useState(Boolean(user?.terms_rules_at));
  const [termsPrivacy, setTermsPrivacy] = useState(Boolean(user?.terms_privacy_at));
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    const name = normalizeNickname(nickname);
    if (!isCyrillicNickname(name)) {
      tg.showAlert('Имя только кириллицей, до 50 символов. Например: Иванов Иван');
      return;
    }
    if (isForbiddenNickname(name)) {
      tg.showAlert(NICK_ABUSE_MESSAGE);
      return;
    }
    setLoading(true);
    try {
      await api.saveProfile({
        nickname: name,
        consent: consent || Boolean(user?.consent_at),
        terms_rules: termsRules || Boolean(user?.terms_rules_at),
        terms_privacy: termsPrivacy || Boolean(user?.terms_privacy_at),
      });
      await onSaved?.();
    } catch (err) {
      tg.showAlert(err.message);
    }
    setLoading(false);
  };

  return (
    <div className={compact ? '' : 'px-4 pt-2 pb-28'}>
      {intro && (
        <div className="card p-5 mb-4 bg-gradient-to-br from-mint-100 to-sun-50 text-center">
          <Sticker name="person" size={72} className="mx-auto" alt="профиль" />
          <h2 className="type-brand mt-2">Ваш профиль</h2>
          <p className="type-body mt-2">
            Укажите, как к Вам обращаться. Это имя увидят другие пользователи.
          </p>
        </div>
      )}

      <form onSubmit={save} className={`card space-y-3 ${compact ? 'p-4' : 'p-5'}`}>
        <label className="block">
          <span className="type-label">Как к Вам обращаться *</span>
          <input
            className="field"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Например: Иванов Иван"
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
        {!user?.terms_rules_at && (
          <TermsCheckbox
            checked={termsRules}
            onChange={setTermsRules}
            onOpen={() => setDoc('rules')}
            before="Я согласен с"
            link="Правилами сообщества"
          />
        )}
        {!user?.terms_privacy_at && (
          <TermsCheckbox
            checked={termsPrivacy}
            onChange={setTermsPrivacy}
            onOpen={() => setDoc('privacy')}
            before="Я согласен с"
            link="политикой обработки персональных данных"
          />
        )}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Сохраняем…' : 'Сохранить'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary w-full">
            Отмена
          </button>
        )}
      </form>

      {intro && (
        <footer className="mt-8 pb-4 text-center">
          <BrandMark size="sm" className="opacity-40" />
          <p className="type-kicker mt-2 opacity-40 tracking-wide">© 2026</p>
        </footer>
      )}

      {doc && (
        <LegalScreen
          docId={doc}
          onClose={() => setDoc(null)}
          onAgree={() => {
            if (doc === 'rules') setTermsRules(true);
            else if (doc === 'privacy') setTermsPrivacy(true);
            setDoc(null);
          }}
        />
      )}
    </div>
  );
}

function TermsCheckbox({ checked, onChange, onOpen, before, link }) {
  return (
    <label className="flex gap-2 items-start pt-1">
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="type-meta">
        {before}{' '}
        <button
          type="button"
          onClick={onOpen}
          className="font-extrabold text-mint-700 underline underline-offset-2 decoration-mint-300 active:opacity-70"
        >
          {link}
        </button>{' '}
        – обязательно.
      </span>
    </label>
  );
}
