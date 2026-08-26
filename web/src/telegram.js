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
