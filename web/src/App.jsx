import { useState, useEffect, useCallback } from 'react';
import { tg } from './telegram';
import { api } from './api';
import BottomNav from './components/BottomNav';
import FeedTab from './components/FeedTab';
import MapTab from './components/MapTab';
import ProfileTab from './components/ProfileTab';
import InfoTab from './components/InfoTab';
import ProfileForm from './components/ProfileForm';
import Sticker from './components/Sticker';
import BrandMark from './components/BrandMark';

export default function App() {
  const [tab, setTab] = useState('profile');
  const [user, setUser] = useState(null);
  const [gateOpen, setGateOpen] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadSlow, setLoadSlow] = useState(false);

  useEffect(() => {
    document.documentElement.style.height = '100%';
    document.documentElement.style.minHeight = '100vh';
    document.body.style.height = 'auto';
    document.body.style.minHeight = '100vh';
    document.body.style.overflowY = 'auto';

    tg.ready();
  }, []);

  const refreshUser = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setLoadSlow(false);
    try {
      const me = await api.getMe();
      setUser(me);
      if (me.profile_complete) setGateOpen(false);
    } catch (e) {
      console.error(e);
      const inTelegram = Boolean(window.Telegram?.WebApp?.initData);
      if (!inTelegram) {
        setLoadError('open_telegram');
      } else {
        const msg = String(e?.message || '');
        setLoadError(
          msg === 'Unauthorized'
            ? 'Не удалось войти через Telegram. Закройте Mini App полностью и откройте снова: @EcoHubBY_bot → /start → «EcoHub сейчас».'
            : 'Не удалось подключиться к серверу EcoHub. Подождите до минуты (сервер может просыпаться) и нажмите «Повторить».',
        );
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  useEffect(() => {
    if (!loading || user) {
      setLoadSlow(false);
      return undefined;
    }
    const t = setTimeout(() => setLoadSlow(true), 8000);
    return () => clearTimeout(t);
  }, [loading, user]);

  const showGate = Boolean(user && !user.profile_complete && gateOpen);

  return (
    <div className="relative min-h-screen pb-28 overflow-x-hidden">
      <div className="organic-blob bg-mint-200/60 w-56 h-56 -top-16 -right-16" />
      <div className="organic-blob bg-sun-100/80 w-44 h-44 top-40 -left-16" />
      <div className="organic-blob bg-mint-100/80 w-64 h-64 bottom-24 -right-20" />

      <header className="sticky top-0 z-50 px-4 pt-4 pb-3">
        <div className="max-w-lg mx-auto card px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sticker name="logo" size={46} />
            <div>
              <h1>
                <BrandMark size="md" className="brand-mark--animate" />
              </h1>
              <p className="type-kicker mt-0.5">Для каждой вещи – свой путь. Выбери его сам!</p>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-lg mx-auto">
        {loadError ? (
          <div className="px-4 pt-6">
            <div className="card p-5 text-center">
              <Sticker name="logo" size={56} className="mx-auto" />
              {loadError === 'open_telegram' ? (
                <>
                  <p className="type-title mt-4">Откройте EcoHub в Telegram</p>
                  <p className="type-body mt-2">
                    Ссылка в браузере не подходит для входа. Зайдите в бота @EcoHubBY_bot, нажмите /start и кнопку «♻️ EcoHub сейчас».
                  </p>
                  <a
                    className="btn-primary mt-4 inline-flex w-full items-center justify-center"
                    href="https://t.me/EcoHubBY_bot"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть @EcoHubBY_bot
                  </a>
                </>
              ) : (
                <>
                  <p className="type-title mt-4">Сервис временно недоступен</p>
                  <p className="type-body mt-2">{loadError}</p>
                  <button type="button" className="btn-primary mt-4 w-full" onClick={refreshUser}>
                    Повторить
                  </button>
                </>
              )}
            </div>
          </div>
        ) : loading && !user ? (
          <div className="px-4 pt-6">
            <div className="card p-5 text-center">
              <Sticker name="logo" size={56} className="mx-auto animate-pulse" />
              <p className="type-title mt-4">Загружается…</p>
              <p className="type-body mt-2">
                {loadSlow
                  ? 'Сервер просыпается после паузы. Подождите до минуты – это нормально, приложение не сломалось.'
                  : 'Подключаемся к EcoHub. Обычно это занимает несколько секунд.'}
              </p>
              {loadSlow && (
                <p className="type-kicker mt-3 text-mint-700/70">
                  Следующие посетители зайдут быстрее, пока сервер уже разбужен.
                </p>
              )}
            </div>
          </div>
        ) : showGate ? (
          <ProfileForm
            user={user}
            onSaved={refreshUser}
            onBrowseMap={() => { setGateOpen(false); setTab('map'); }}
            intro
          />
        ) : (
          <>
            {tab === 'feed' && <FeedTab user={user} onRefresh={refreshUser} onNeedProfile={() => { setGateOpen(true); setTab('profile'); }} />}
            {tab === 'map' && <MapTab />}
            {tab === 'profile' && <ProfileTab user={user} onRefresh={refreshUser} />}
            {tab === 'info' && <InfoTab />}
          </>
        )}
      </main>

      {!showGate && !loadError && !(loading && !user) && <BottomNav active={tab} onChange={setTab} />}
    </div>
  );
}
