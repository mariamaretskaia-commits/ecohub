import { useState } from 'react';
import { api } from '../api';
import { tg } from '../telegram';
import Sticker from './Sticker';
import { formatLocation } from '../locations';
import { itemPhotos, photoSrc } from '../photos';
import PhotoLightbox from './PhotoLightbox';

export default function ItemCard({ item, currentUser, onUpdate, onNeedProfile, onEdit, ownerMode = false }) {
  const [wanting, setWanting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slide, setSlide] = useState(0);
  const [lightbox, setLightbox] = useState(null);
  const isOwner = ownerMode
    || (currentUser && String(item.telegram_id) === String(currentUser.telegram_id));
  const photos = itemPhotos(item);
  const active = Math.min(slide, Math.max(0, photos.length - 1));

  const handleWant = async () => {
    if (!currentUser?.profile_complete) {
      onNeedProfile?.();
      return;
    }
    if (wanting) return;
    setWanting(true);
    try {
      const result = await api.wantItem(item.id);
      tg.showAlert(
        result.notified
          ? 'Автор получил отклик в боте. Пишите @EcoHubBY_bot – сообщения уйдут автору. Личный профиль Telegram не открываем.'
          : 'Отклик сохранён. Автор ещё не открывал бота – попросите нажать /start в @EcoHubBY_bot.',
      );
    } catch (e) {
      tg.showAlert(e.message);
    } finally {
      setWanting(false);
    }
  };

  const handleGive = async () => {
    if (!confirm('Подтвердить, что вещь отдана?')) return;
    setBusy(true);
    try {
      await api.markGiven(item.id);
      tg.showAlert('Вещь отмечена как отданная.');
      onUpdate?.();
    } catch (e) {
      tg.showAlert(e.message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Удалить объявление? Его больше не увидят в ленте.')) return;
    setBusy(true);
    try {
      await api.deleteItem(item.id);
      tg.showAlert('Объявление удалено.');
      onUpdate?.();
    } catch (e) {
      tg.showAlert(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      {photos.length > 0 ? (
        <div className="relative bg-mint-50">
          <button
            type="button"
            className="block w-full aspect-[3/4] overflow-hidden p-0 border-0 bg-transparent"
            onClick={() => setLightbox(active)}
            aria-label="Открыть фото"
          >
            <img
              src={photoSrc(photos[active])}
              alt={item.title}
              className="w-full h-full object-cover"
            />
          </button>
          {photos.length > 1 && (
            <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
              {photos.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  aria-label={`Фото ${idx + 1}`}
                  onClick={() => setSlide(idx)}
                  className={`h-2 rounded-full transition-all ${
                    idx === active ? 'w-5 bg-white' : 'w-2 bg-white/55'
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="w-full aspect-[3/4] max-h-72 bg-gradient-to-br from-mint-100 to-sun-50 flex items-center justify-center">
          <Sticker name="sprout" size={72} />
        </div>
      )}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="type-title">{item.title}</h3>
          <span className="text-xs px-2.5 py-1 rounded-full font-extrabold whitespace-nowrap bg-mint-100 text-mint-700">
            Даром
          </span>
        </div>
        {item.description && (
          <p className="type-body mt-1 line-clamp-2">{item.description}</p>
        )}
        <div className="flex items-center gap-3 mt-3 type-meta">
          <span>{formatLocation(item)}</span>
          <span>·</span>
          <span>{item.category}</span>
          {!ownerMode && (
            <>
              <span>·</span>
              <span>{item.first_name}</span>
            </>
          )}
        </div>
        <div className="flex flex-col gap-2 mt-4">
          {!isOwner ? (
            <button onClick={handleWant} disabled={wanting} className="btn-primary flex-1 py-3">
              {wanting ? 'Отправляем…' : 'Хочу взять'}
            </button>
          ) : (
            <>
              <button onClick={handleGive} disabled={busy} className="btn-secondary w-full flex items-center justify-center gap-2">
                Вещь отдана
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onEdit?.(item)}
                  disabled={busy || !onEdit}
                  className="btn-secondary flex-1 py-2.5"
                >
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex-1 py-2.5 rounded-full text-sm font-extrabold text-[#b42318] bg-white border border-[#f3c0bc] active:scale-95 transition-transform shadow-soft"
                >
                  Удалить
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {lightbox !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      )}
    </div>
  );
}
