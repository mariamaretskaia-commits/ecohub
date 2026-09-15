import { useRef, useState } from 'react';
import { api, CATEGORIES, POINT_TYPES } from '../api';
import { tg } from '../telegram';
import { fileToJpeg } from '../photos';
import { classifyImage } from '../ai/classifier';
import { detectLocation } from '../geo';
import Sticker from './Sticker';

const DRAFT_KEY = 'ecohub_vision_draft';

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDraft(data) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function dataUrlToFile(dataUrl) {
  return fetch(dataUrl)
    .then((r) => r.blob())
    .then((b) => new File([b], 'draft.jpg', { type: 'image/jpeg' }))
    .catch(() => null);
}

const VISIBLE_TYPES = Object.keys(POINT_TYPES);

export default function VisionFlow({ onClose, onGiveAway, onOpenMap }) {
  const [screen, setScreen] = useState('pick'); // pick | classified | route
  const [photo, setPhoto] = useState(null); // { file, url }
  const [busy, setBusy] = useState(false);
  const [detected, setDetected] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Одежда');
  const [plan, setPlan] = useState(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [geo, setGeo] = useState({ state: 'idle', result: null });
  const [draft, setDraft] = useState(loadDraft);
  const inputRef = useRef(null);

  const pickAndAnalyze = async (file) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      const jpeg = await fileToJpeg(file, { maxSide: 1400, quality: 0.85 });
      setPhoto({ file: jpeg, url: URL.createObjectURL(jpeg) });
      setScreen('classified');
      const result = await classifyImage(jpeg);
      setDetected(result);
      setTitle(String(result?.name || '').trim());
      if (result?.category) setCategory(result.category);
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось распознать фото');
      setScreen('pick');
    } finally {
      setBusy(false);
    }
  };

  const handleInput = (e) => {
    const [file] = Array.from(e.target.files || []);
    e.target.value = '';
    if (file) pickAndAnalyze(file);
  };

  const restoreDraft = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const file = await dataUrlToFile(draft.image);
      setPhoto({ file: file || null, url: draft.image });
      setTitle(String(draft.title || ''));
      setCategory(draft.category || 'Одежда');
      setDetected(null);
      setScreen('classified');
    } finally {
      setBusy(false);
    }
  };

  const discardDraft = () => {
    clearDraft();
    setDraft(null);
  };

  const handleSaveDraft = async () => {
    if (!photo?.file) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(photo.file);
      });
      const ok = saveDraft({ title: title.trim(), category, image: dataUrl });
      tg.showAlert(ok ? 'Черновик сохранён. Продолжить можно через «Разобрать вещи».' : 'Не удалось сохранить черновик');
      onClose();
    } catch {
      tg.showAlert('Не удалось сохранить черновик');
    } finally {
      setBusy(false);
    }
  };

  const handleGeo = async () => {
    if (geo.state === 'busy') return;
    setGeo({ state: 'busy', result: null });
    const result = await detectLocation();
    if (!result) {
      setGeo({ state: 'error', result: null });
      return;
    }
    setGeo({ state: 'done', result });
  };

  const handleGiveAway = () => {
    if (!title.trim()) {
      tg.showAlert('Назовите вещь');
      return;
    }
    const file = photo?.file;
    const location = geo.state === 'done' && geo.result ? geo.result : undefined;
    if (file) {
      clearDraft();
      onGiveAway({ title: title.trim(), category, file, location });
    } else {
      onGiveAway({ title: title.trim(), category, location });
    }
  };

  const handlePlan = async () => {
    if (planBusy) return;
    setPlanBusy(true);
    try {
      const pos = await new Promise((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
          () => resolve(null),
          { timeout: 5000, maximumAge: 60000 },
        );
      });
      const result = await api.planRecycling({
        categories: [category],
        lat: pos?.lat,
        lng: pos?.lng,
      });
      setPlan(result);
      setScreen('route');
    } catch (err) {
      tg.showAlert(err.message || 'Не удалось построить маршрут');
    } finally {
      setPlanBusy(false);
    }
  };

  const openMap = (types) => {
    const known = (types || []).filter((t) => VISIBLE_TYPES.includes(t));
    onOpenMap(known.length ? known : null);
  };

  const back = () => {
    setScreen('pick');
    setPlan(null);
    setDetected(null);
    setTitle('');
    setCategory('Одежда');
    setGeo({ state: 'idle', result: null });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#f6f8f4] overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 pt-4 pb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sticker name="recycle" size={38} alt="разбор вещей" />
            <h2 className="type-brand">Разобрать вещи</h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white shadow-soft text-ink/50 text-xl font-black"
            aria-label="Закрыть"
          >
            &times;
          </button>
        </div>

        {screen === 'pick' && (
          <div className="space-y-4">
            <div className="card p-5 text-center">
              <Sticker name="recycle" size={88} className="mx-auto mb-3" alt="фото" />
              <p className="type-title">Что хотите отдать?</p>
              <p className="type-body mt-1">
                Сфотографируйте вещь — распознаем её сами, предложим куда сдать и поможем оформить объявление.
              </p>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,image/heic,image/heif,.heic,.heif"
                className="hidden"
                onChange={handleInput}
              />
              <button
                type="button"
                className="btn-primary mt-4 w-full"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                {busy ? 'Распознаём…' : 'Выбрать фото'}
              </button>
              <button
                type="button"
                className="btn-secondary mt-3 w-full"
                onClick={() => {
                  onGiveAway({ title: '', category });
                }}
              >
                Заполнить вручную
              </button>
            </div>

            {draft && (
              <div className="card p-4 flex items-center gap-3">
                {draft.image ? (
                  <img src={draft.image} alt="" className="w-14 h-14 rounded-xl object-cover" />
                ) : (
                  <Sticker name="clock" size={56} alt="черновик" />
                )}
                <div className="flex-1">
                  <p className="type-title text-sm">{draft.title || 'Фото из черновика'}</p>
                  <p className="type-empty text-xs">{draft.category}</p>
                </div>
                <button type="button" className="btn-mint px-3 py-2" onClick={restoreDraft}>
                  Продолжить
                </button>
              </div>
            )}

            <button type="button" className="w-full text-center type-empty py-2" onClick={onClose}>
              Позже
            </button>
          </div>
        )}

        {screen === 'classified' && (
          <div className="space-y-4">
            {photo?.url && (
              <div className="card p-4">
                <img
                  src={photo.url}
                  alt=""
                  className="w-full max-h-72 object-contain rounded-xl bg-mint-50"
                />
                <div className="mt-3 flex items-center justify-between">
                  <span className="type-empty text-xs">
                    {detected
                      ? `${detected.source === 'clip' ? 'Распознано на устройстве' : 'Распознано'} · уверенность ${Math.round(detected.confidence * 100)}%`
                      : 'Не удалось распознать — выберите категорию вручную'}
                  </span>
                  <button type="button" className="type-empty text-xs underline underline-offset-2" onClick={() => inputRef.current?.click()}>
                    Другое фото
                  </button>
                </div>
              </div>
            )}

            <label className="block">
              <span className="type-label">Название</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="field"
                placeholder="Например: Детский велосипед"
                autoComplete="off"
              />
            </label>

            <label className="block">
              <span className="type-label">Категория</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="field"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>

            <div>
              <button type="button" className="btn-secondary w-full" disabled={geo.state === 'busy'} onClick={handleGeo}>
                {geo.state === 'busy'
                  ? 'Определяем локацию…'
                  : geo.state === 'done'
                    ? 'Мой район определён ✓'
                    : 'Определить мой район автоматически'}
              </button>
              {geo.state === 'done' && geo.result && (
                <p className="type-empty text-xs mt-1.5">
                  Локация: {geo.result.settlement || geo.result.oblast}
                  {geo.result.district ? ` · ${geo.result.district}` : ''}
                </p>
              )}
              {geo.state === 'error' && (
                <p className="type-empty text-xs mt-1.5">
                  Не удалось определить местоположение — локацию можно выбрать в форме.
                </p>
              )}
            </div>

            <button type="button" className="btn-mint w-full" disabled={busy} onClick={handleGiveAway}>
              Отдать бесплатно
            </button>
            <button type="button" className="btn-primary w-full" disabled={planBusy} onClick={handlePlan}>
              {planBusy ? 'Ищем пункты…' : 'Куда сдать на переработку'}
            </button>
            <button type="button" className="btn-secondary w-full" disabled={busy} onClick={handleSaveDraft}>
              Сохранить черновик
            </button>

            <button type="button" className="w-full text-center type-empty py-2" onClick={back}>
              Назад
            </button>
          </div>
        )}

        {screen === 'route' && plan && (
          <RoutePlan
            plan={plan}
            onOpenMap={(types) => {
              openMap(types);
            }}
            onBack={() => setScreen('classified')}
            onRestart={() => back()}
            onDiscardDraft={() => {
              clearDraft();
              setDraft(null);
            }}
            draft={draft}
          />
        )}
      </div>
    </div>
  );
}

function acceptedTypes(point) {
  const raw = `${String(point?.accepts || '')},${String(point?.type || '')}`;
  return raw.split(',').map((s) => s.trim()).filter((t) => POINT_TYPES[t]);
}

function RoutePlan({ plan, onOpenMap, onBack, onRestart, onDiscardDraft, draft }) {
  const routes = Array.isArray(plan.routes) ? plan.routes : [];
  const uncovered = Array.isArray(plan.uncovered) ? plan.uncovered : [];

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center gap-2">
          <Sticker name="recycle" size={40} alt="маршрут" />
          <h3 className="type-title">План сдачи на переработку</h3>
        </div>
        <p className="type-body mt-2">
          {routes.length
            ? `Нашли пункты для ${routes.reduce((s, r) => s + r.categories.length, 0)} категорий.`
            : 'Не нашли подходящих пунктов.'}
        </p>
      </div>

      {routes.map((route, i) => {
        const types = acceptedTypes(route.point);
        const type = types[0] || 'other';
        const label = POINT_TYPES[type]?.label || 'Пункт приёма';
        return (
          <div key={route.point?.id || i} className="card p-4">
            <div className="flex items-start gap-3">
              <Sticker name={POINT_TYPES[type]?.sticker || 'other'} size={48} alt={label} />
              <div className="flex-1">
                <p className="type-title text-base leading-snug">
                  {route.point?.name || 'Пункт приёма'}
                </p>
                <p className="type-body text-sm mt-0.5">
                  {label}
                  {route.distanceKm != null && ` · ${formatKm(route.distanceKm)}`}
                </p>
                <p className="type-empty text-sm mt-0.5">{route.point?.address}</p>
              </div>
            </div>
            <p className="type-body text-sm mt-3">{route.reason}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {route.categories.map((c) => (
                <span key={c} className="px-2 py-0.5 rounded-full bg-mint-100 text-mint-800 text-xs font-semibold">
                  {c}
                </span>
              ))}
            </div>
            <button type="button" className="btn-secondary mt-4 w-full" onClick={() => onOpenMap(types)}>
              Показать на карте
            </button>
          </div>
        );
      })}

      {uncovered.length > 0 && (
        <div className="card p-4 border border-sun-200">
          <p className="type-title text-sm">Не нашли пункт для:</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {uncovered.map((c) => (
              <span key={c} className="px-2 py-0.5 rounded-full bg-sun-100 text-ink/70 text-xs font-semibold">
                {c}
              </span>
            ))}
          </div>
          <p className="type-empty text-sm mt-2">
            Попробуйте поискать на карте или предложить свой пункт приёма.
          </p>
        </div>
      )}

      {draft && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <p className="type-empty text-xs">Черновик не используется в маршруте.</p>
          <button type="button" className="btn-secondary px-3 py-2" onClick={onDiscardDraft}>
            Удалить черновик
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onBack}>
          Назад
        </button>
        <button type="button" className="btn-secondary flex-1" onClick={onRestart}>
          Другой предмет
        </button>
      </div>
    </div>
  );
}

function formatKm(km) {
  if (km < 1) return `${Math.round(km * 1000)} м`;
  return `${km.toFixed(1)} км`;
}