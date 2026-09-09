import { useState, useEffect, useCallback } from 'react';
import { tg } from './telegram';
import { api } from './api';
import BottomNav from './components/BottomNav';
import FeedTab from './components/FeedTab';
import MapTab from './components/MapTab';
import ProfileTab from './components/ProfileTab';
import InfoTab from './components/InfoTab';
import ChatTab from './components/ChatTab';
import Sticker from './components/Sticker';
import BrandMark from './components/BrandMark';

export default function App() {
  const [tab, setTab] = useState('profile');
  const [user, setUser] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadSlow, setLoadSlow] = useState(false);
  const [chatWantId, setChatWantId] = useState(null);
  const [chatUnread, setChatUnread] = useState(0);

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
      sessionStorage.removeItem('ecohub_reload_attempted');
      setUser(me);
    } catch (e) {
      console.error(e);
      const webAppExists = Boolean(window.Telegram?.WebApp);
      const inTelegram = Boolean(window.Telegram?.WebApp?.initData);
      // Resumed from the status-bar session: Telegram WebView exists but
      // initData may arrive a moment after load. Do NOT reload or close —
      // wait up to ~6s for Telegram to inject it, then retry auth.
      if (webAppExists && !inTelegram) {
        let tries = 0;
        const pollInitData = setInterval(() => {
          tries += 1;
          if (window.Telegram?.WebApp?.initData) {
            clearInterval(pollInitData);
            try {
              sessionStorage.removeItem('ecohub_reload_attempted');
            } catch {
              /* ignore */
            }
            tg.ready();
            refreshUser();
            return;
          }
          if (tries >= 20) {
            clearInterval(pollInitData);
            // Telegram never initialized this stale session: show the minimal
            // launch screen instead of silently closing (never self-close —
            // that makes the status bar look broken).
            setLoadError('open_telegram');
          }
        }, 300);
        setLoading(false);
        return;
      }
      if (!inTelegram) {
        setLoadError('open_telegram');
      } else {
        const msg = String(e?.message || '');
        setLoadError(
          msg === 'Unauthorized'
            ? 'Не удалось войти через Telegram. Полностью закройте Mini App и откройте снова: @EcoHubBY_bot → /start → кнопка «Запустить EcoHub».'
            : 'Не удалось подключиться к серверу EcoHub. Подождите до минуты (сервер может просыпаться) и нажмите «Повторить», или откройте снова через @EcoHubBY_bot → /start.',
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

  // Opened outside Telegram (e.g. from the stale "EcoHub сейчас" status bar).
  // On mobile, re-enter Telegram automatically so the app launches for real.
  useEffect(() => {
    if (loadError !== 'open_telegram') return undefined;
    if (!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return undefined;
    const t = setTimeout(() => {
      window.location.replace('https://t.me/EcoHubBY_bot/ecohub');
    }, 1500);
    return () => clearTimeout(t);
  }, [loadError]);

  // The "EcoHub сейчас" status bar only exists while the Mini App stays
  // "running in background". Close the session shortly AFTER the app is really
  // hidden (home gesture / switch away), with a delay so transient visibility
  // changes while Telegram resumes the WebView don't kill the app.
  useEffect(() => {
    let closeTimer = null;
    const scheduleClose = () => {
      if (!window.Telegram?.WebApp?.initData) return;
      if (closeTimer) return;
      closeTimer = setTimeout(() => {
        closeTimer = null;
        try {
          tg.close();
        } catch {
          /* ignore */
        }
      }, 2500);
    };
    const cancelClose = () => {
      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') scheduleClose();
      else cancelClose();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', scheduleClose);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', scheduleClose);
      if (closeTimer) clearTimeout(closeTimer);
    };
  }, []);

  useEffect(() => {
    if (!user?.profile_complete) return undefined;
    const refreshUnread = () => {
      api.getChatUnread()
        .then((data) => setChatUnread(Number(data?.count || 0)))
        .catch(() => {});
    };
    refreshUnread();
    const t = setInterval(refreshUnread, 20000);
    return () => clearInterval(t);
  }, [user?.profile_complete, user?.id, tab]);

  const scrollPageTop = useCallback(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    window.Telegram?.WebApp?.scrollTo?.(0, 0);
  }, []);

  const changeTab = useCallback((nextTab) => {
    setTab(nextTab);
    requestAnimationFrame(() => {
      scrollPageTop();
      requestAnimationFrame(scrollPageTop);
    });
  }, [scrollPageTop]);

  const openChat = useCallback((wantId) => {
    if (wantId) setChatWantId(wantId);
    changeTab('chat');
  }, [changeTab]);

  const goToFeed = useCallback(() => {
    changeTab('feed');
  }, [changeTab]);

  const enterTelegram = useCallback(() => {
    // Prefer the native scheme (works inside Telegram's built-in browser and
    // on phones): it opens the registered Mini App "ecohub" directly.
    // If the client blocks tg://, fall back to the https direct link.
    try {
      window.location.href = 'tg://resolve?domain=EcoHubBY_bot&appname=ecohub';
    } catch {
      /* ignore */
    }
    setTimeout(() => {
      window.location.href = 'https://t.me/EcoHubBY_bot/ecohub';
    }, 700);
  }, []);

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
                <BrandMark size="md" animate />
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
                  <p className="type-body mt-2">Мини-приложение открывается в Telegram.</p>
                  <button
                    type="button"
                    className="btn-primary mt-4 inline-flex w-full items-center justify-center"
                    onClick={enterTelegram}
                  >
                    Запустить EcoHub
                  </button>
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
            </div>
          </div>
        ) : (
          <>
            {tab === 'feed' && (
              <FeedTab
                user={user}
                onRefresh={refreshUser}
                onNeedProfile={() => changeTab('profile')}
                onOpenChat={openChat}
              />
            )}
            {tab === 'map' && <MapTab />}
            {tab === 'chat' && (
              <ChatTab
                user={user}
                initialWantId={chatWantId}
                onInitialWantHandled={() => setChatWantId(null)}
                onUnreadChange={setChatUnread}
                onNeedProfile={() => changeTab('profile')}
                onGoToFeed={goToFeed}
              />
            )}
            {tab === 'profile' && (
              <ProfileTab user={user} onRefresh={refreshUser} onGoToFeed={goToFeed} />
            )}
            {tab === 'info' && <InfoTab onChangeTab={changeTab} />}
          </>
        )}
      </main>

      {!loadError && !(loading && !user) && (
        <BottomNav active={tab} onChange={changeTab} chatUnread={chatUnread} />
      )}
    </div>
  );
}
