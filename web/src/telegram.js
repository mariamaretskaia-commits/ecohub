function getWebApp() {
  return window.Telegram?.WebApp || null;
}

export const tg = {
  ready() {
    const app = getWebApp();
    if (!app) return;
    try {
      app.ready();
      app.expand?.();
      app.setHeaderColor?.('#fff8ee');
      app.setBackgroundColor?.('#f3fbf6');
    } catch {
      // ignore outside Telegram
    }
  },
  showAlert(message) {
    const app = getWebApp();
    if (app?.showAlert) app.showAlert(message);
    else window.alert(message);
  },
  showConfirm(message) {
    return new Promise((resolve) => {
      const app = getWebApp();
      const inTelegram = Boolean(app?.initData);
      if (inTelegram && typeof app.showConfirm === 'function') {
        try {
          app.showConfirm(String(message), (ok) => resolve(Boolean(ok)));
          return;
        } catch {
          /* fall through */
        }
      }
      resolve(window.confirm(String(message)));
    });
  },
  openLink(url) {
    const app = getWebApp();
    if (app?.openLink) app.openLink(url);
    else window.open(url, '_blank');
  },
  openTelegramLink(url) {
    const app = getWebApp();
    if (app?.openTelegramLink) app.openTelegramLink(url);
    else window.open(url, '_blank');
  },
  get initData() {
    return getWebApp()?.initData || '';
  },
};
