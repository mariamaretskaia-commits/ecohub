import { api, POINT_TYPES } from '../api';
import { tg } from '../telegram';
import { telHref } from '../phone';
import { accessInfo } from '../point-access';
import Sticker from './Sticker';

export default function PointDetail({ point, onBack }) {
  const typeInfo = POINT_TYPES[point.type] || POINT_TYPES.paper;
  const access = accessInfo(point);
  const callHref = telHref(point.phone);
  const isTelegramSite = /t\.me\//i.test(point.website || '');

  const handleWebsite = () => {
    if (!point.website) return;
    if (isTelegramSite) tg.openTelegramLink(point.website);
    else tg.openLink(point.website);
  };

  return (
    <div className="px-4 pt-4 pb-24">
      <button onClick={onBack} className="btn-secondary mb-4 inline-flex items-center gap-2">
        <Sticker name="pin" size={20} className="!drop-shadow-none" />
        Назад к карте
      </button>

      <div className="card p-5">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-2xl bg-mint-50 flex items-center justify-center flex-shrink-0">
            <Sticker name={typeInfo.sticker || 'pin'} size={40} />
          </div>
          <div>
            <h2 className="type-title">{point.name}</h2>
            <p className="type-kicker mt-0.5">{typeInfo.label}</p>
            {point.organization && (
              <p className="type-meta mt-0.5">{point.organization}</p>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-mint-50 px-3 py-3">
          <p className="type-label">{access.label}</p>
          <p className="type-meta mt-0.5">{access.text}</p>
        </div>

        <div className="mt-4 space-y-3">
          {point.district && (
            <InfoRow
              sticker="pin"
              label="Район"
              value={/район/i.test(point.district) ? point.district : `${point.district} район`}
            />
          )}
          <InfoRow sticker="pin" label="Адрес" value={point.address} />
          {point.hours && <InfoRow sticker="clock" label="Режим работы" value={point.hours} />}
          {point.prices && <InfoRow sticker="coin" label="Прайс" value={point.prices} />}
          {point.phone && (
            <InfoRow
              sticker="phone"
              label="Телефон"
              value={point.phone}
              href={callHref}
            />
          )}
          {point.transit && <InfoRow sticker="bus" label="Ближайшая остановка" value={point.transit} />}
          {point.logistics && <InfoRow sticker="truck" label="Логистика" value={point.logistics} />}
          {point.description && <InfoRow sticker="info" label="Описание" value={point.description} />}
          {point.last_synced && (
            <p className="type-meta">Обновлено с официального сайта: {point.last_synced}</p>
          )}
        </div>

        <div className="flex gap-2 mt-5">
          {callHref && (
            <a href={callHref} className="btn-primary flex-1 py-2.5 inline-flex items-center justify-center gap-1.5 no-underline">
              <Sticker name="phone" size={20} className="!drop-shadow-none" />
              Позвонить
            </a>
          )}
          {isTelegramSite && (
            <button onClick={handleWebsite} className="btn-secondary flex-1 inline-flex items-center justify-center gap-1.5">
              <Sticker name="sprout" size={20} className="!drop-shadow-none" />
              Написать
            </button>
          )}
          {point.website && !isTelegramSite && (
            <button onClick={handleWebsite} className="btn-secondary flex-1 inline-flex items-center justify-center gap-1.5">
              <Sticker name="globe" size={20} className="!drop-shadow-none" />
              Сайт
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function InfoRow({ sticker, label, value, href }) {
  return (
    <div className="flex gap-2.5 items-start">
      <Sticker name={sticker} size={22} className="mt-0.5 !drop-shadow-none" />
      <div>
        <span className="type-label">{label}: </span>
        {href ? (
          <a href={href} className="type-body text-mint-700 underline underline-offset-2">
            {value}
          </a>
        ) : (
          <span className="type-body">{value}</span>
        )}
      </div>
    </div>
  );
}
