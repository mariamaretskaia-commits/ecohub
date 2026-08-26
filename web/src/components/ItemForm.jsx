import { useId, useState } from 'react';
import { api, CATEGORIES } from '../api';
import { tg } from '../telegram';
import { findAbuse, ABUSE_MESSAGE } from '../moderation';
import { fileToJpeg, itemPhotos, photoSrc } from '../photos';
import Sticker from './Sticker';
import LocationSelect from './LocationSelect';

const MAX_PHOTOS = 5;

export default function ItemForm({ item = null, onClose, onSaved }) {
  const editing = Boolean(item?.id);
  const photoInputId = useId();
  const [form, setForm] = useState({
    title: item?.title || '',
    description: item?.description || '',
    oblast: item?.oblast || 'Гродненская область',
    settlement: item?.settlement || 'Гродно',
    district: item?.district || '',
    category: item?.category || 'Одежда',
  });
  const [photos, setPhotos] = useState(() =>
    itemPhotos(item).map((url) => ({ url, preview: photoSrc(url) })),
  );
  const [loading, setLoading] = useState(false);

  const handlePhoto = async (e) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;

    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      tg.showAlert(`Можно прикрепить не больше ${MAX_PHOTOS} фото`);
      return;
    }

    setLoading(true);
    try {
      const next = [];
      for (const file of picked.slice(0, room)) {
        const jpeg = await fileToJpeg(file);
        next.push({
          file: jpeg,
          preview: URL.createObjectURL(jpeg),
        });
      }
      setPhotos((prev) => [...prev, ...next]);
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось добавить фото. Попробуйте JPEG или PNG.');
    }
    setLoading(false);
  };

  const removePhoto = (idx) => {
    setPhotos((prev) => {
      const copy = [...prev];
      const [gone] = copy.splice(idx, 1);
      if (gone?.file && gone?.preview) URL.revokeObjectURL(gone.preview);
      return copy;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) {
      tg.showAlert('Укажите название вещи');
      return;
    }
    if (findAbuse(form.title) || findAbuse(form.description)) {
      tg.showAlert(ABUSE_MESSAGE);
      return;
    }
    if (!form.oblast || !form.settlement || !form.district) {
      tg.showAlert('Выберите область, населённый пункт и район');
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      fd.append('type', 'free');
      const keep = photos.filter((p) => p.url && !p.file).map((p) => p.url);
      fd.append('keep_photos', JSON.stringify(keep));
      photos.filter((p) => p.file).forEach((p) => fd.append('photos', p.file, p.file.name || 'photo.jpg'));

      if (editing) {
        await api.updateItem(item.id, fd);
        tg.showAlert('Объявление обновлено.');
      } else {
        await api.createItem(fd);
        tg.showAlert('Объявление опубликовано. Его видно другим во вкладке Даром, у вас – в профиле.');
      }
      onSaved?.();
    } catch (err) {
      tg.showAlert(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="px-4 pt-2 pb-28">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sticker name="share" size={36} alt="передача вещи" />
          <h2 className="type-brand">{editing ? 'Редактировать' : 'Поделиться вещью'}</h2>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-full bg-white shadow-soft text-ink/50 text-xl font-black">&times;</button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <span className="type-label">Фото – до {MAX_PHOTOS}, формат 3:4 в ленте</span>
          <div className="mt-1 grid grid-cols-3 gap-2">
            {photos.map((p, idx) => (
              <div key={p.preview || p.url || idx} className="relative aspect-[3/4] rounded-2xl overflow-hidden border border-mint-100 bg-white">
                <img src={p.preview} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(idx)}
                  className="absolute top-1 right-1 w-7 h-7 rounded-full bg-ink/70 text-white text-sm font-black"
                  aria-label="Удалить фото"
                >
                  ×
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => document.getElementById(photoInputId)?.click()}
                className="aspect-[3/4] rounded-2xl border-2 border-dashed border-mint-200 bg-white flex items-center justify-center type-empty px-2 text-center"
              >
                Добавить фото
              </button>
            )}
          </div>
          <input
            id={photoInputId}
            type="file"
            accept="image/*,image/heic,image/heif,.heic,.heif"
            multiple
            className="hidden"
            onChange={handlePhoto}
          />
        </div>

        <label className="block">
          <span className="type-label">Название *</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="field"
            placeholder="Например: Детский велосипед"
          />
        </label>

        <label className="block">
          <span className="type-label">Описание</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="field h-24 resize-none"
            placeholder="Что именно отдаёте: платье, размер, состояние…"
          />
        </label>

        <LocationSelect
          oblast={form.oblast}
          settlement={form.settlement}
          district={form.district}
          onChange={(loc) => setForm({ ...form, ...loc })}
          required
        />

        <label className="block">
          <span className="type-label">Категория</span>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="field"
          >
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <button type="submit" disabled={loading} className="btn-mint w-full">
          {loading ? (editing ? 'Сохранение...' : 'Публикация...') : (editing ? 'Сохранить' : 'Опубликовать')}
        </button>
      </form>
    </div>
  );
}
