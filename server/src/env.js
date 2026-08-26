const PLACEHOLDER_HOSTS = ['your-domain.com', 'localhost', '127.0.0.1'];

function cleanUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function isPlaceholder(url) {
  if (!url) return true;
  try {
    const host = new URL(url).hostname;
    if (host === 'your-domain.com' || host === 'localhost' || host === '127.0.0.1') return true;
    const onHosted = Boolean(
      process.env.RAILWAY_PUBLIC_DOMAIN
      || process.env.RAILWAY_STATIC_URL
      || process.env.RENDER_EXTERNAL_URL
      || process.env.FLY_APP_NAME,
    );
    if (onHosted && host.endsWith('.trycloudflare.com')) return true;
    return false;
  } catch {
    return true;
  }
}

/** Public HTTPS URL for Mini App and Telegram webhook. */
export function resolveWebAppUrl() {
  const explicit = cleanUrl(process.env.WEBAPP_URL);
  if (explicit && !isPlaceholder(explicit)) return explicit;

  const railway = cleanUrl(process.env.RAILWAY_STATIC_URL)
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '');
  if (railway) return railway;

  const render = cleanUrl(process.env.RENDER_EXTERNAL_URL);
  if (render) return render;

  const fly = cleanUrl(process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : '');
  if (fly) return fly;

  return explicit || null;
}
