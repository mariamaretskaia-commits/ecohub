import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { photoSrc } from '../photos';

function hypot(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function mid(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

export default function PhotoLightbox({ photos, index, onClose, onIndex }) {
  const list = photos || [];
  const i = Math.min(Math.max(0, index), Math.max(0, list.length - 1));
  const src = photoSrc(list[i]);

  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const state = useRef({
    scale: 1,
    x: 0,
    y: 0,
    mode: null,
    startScale: 1,
    startX: 0,
    startY: 0,
    startDist: 1,
    pointerX: 0,
    pointerY: 0,
    lastTap: 0,
    moved: false,
  });

  const paint = () => {
    const img = imgRef.current;
    if (!img) return;
    const { scale, x, y } = state.current;
    img.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
  };

  const clamp = () => {
    const s = state.current;
    s.scale = Math.min(4, Math.max(1, s.scale));
    if (s.scale <= 1.02) {
      s.scale = 1;
      s.x = 0;
      s.y = 0;
    }
    paint();
  };

  const reset = () => {
    state.current.scale = 1;
    state.current.x = 0;
    state.current.y = 0;
    paint();
  };

  const zoomBy = (factor) => {
    state.current.scale *= factor;
    clamp();
  };

  const toggleZoom = () => {
    if (state.current.scale > 1.2) reset();
    else {
      state.current.scale = 2.5;
      state.current.x = 0;
      state.current.y = 0;
      paint();
    }
  };

  useEffect(() => {
    reset();
  }, [src, i]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowRight' && list.length > 1) onIndex?.((i + 1) % list.length);
      if (e.key === 'ArrowLeft' && list.length > 1) onIndex?.((i - 1 + list.length) % list.length);
      if (e.key === '+' || e.key === '=') zoomBy(1.2);
      if (e.key === '-') zoomBy(1 / 1.2);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [i, list.length, onClose, onIndex]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const onTouchStart = (e) => {
      const s = state.current;
      s.moved = false;
      if (e.touches.length === 2) {
        e.preventDefault();
        s.mode = 'pinch';
        s.startDist = hypot(e.touches[0], e.touches[1]) || 1;
        s.startScale = s.scale;
        s.startX = s.x;
        s.startY = s.y;
        s.lastTap = 0;
        return;
      }
      if (e.touches.length === 1) {
        s.mode = 'pan';
        s.pointerX = e.touches[0].clientX;
        s.pointerY = e.touches[0].clientY;
        s.startX = s.x;
        s.startY = s.y;
        s.startScale = s.scale;
      }
    };

    const onTouchMove = (e) => {
      const s = state.current;
      if (e.touches.length === 2) {
        e.preventDefault();
        s.moved = true;
        s.mode = 'pinch';
        if (!s.startDist) {
          s.startDist = hypot(e.touches[0], e.touches[1]) || 1;
          s.startScale = s.scale;
        }
        const ratio = hypot(e.touches[0], e.touches[1]) / s.startDist;
        s.scale = s.startScale * ratio;
        clamp();
        return;
      }
      if (e.touches.length === 1 && s.mode === 'pan' && s.scale > 1.05) {
        e.preventDefault();
        const dx = e.touches[0].clientX - s.pointerX;
        const dy = e.touches[0].clientY - s.pointerY;
        if (Math.abs(dx) + Math.abs(dy) > 6) s.moved = true;
        s.x = s.startX + dx;
        s.y = s.startY + dy;
        paint();
      }
    };

    const onTouchEnd = (e) => {
      const s = state.current;
      if (e.touches.length > 0) {
        if (e.touches.length === 1) {
          s.mode = 'pan';
          s.pointerX = e.touches[0].clientX;
          s.pointerY = e.touches[0].clientY;
          s.startX = s.x;
          s.startY = s.y;
        }
        return;
      }

      const wasPinch = s.mode === 'pinch';
      s.mode = null;
      clamp();

      if (wasPinch || s.moved) return;
      if (e.changedTouches.length !== 1) return;

      const now = Date.now();
      if (now - s.lastTap < 350) {
        s.lastTap = 0;
        toggleZoom();
      } else {
        s.lastTap = now;
      }
    };

    stage.addEventListener('touchstart', onTouchStart, { passive: false });
    stage.addEventListener('touchmove', onTouchMove, { passive: false });
    stage.addEventListener('touchend', onTouchEnd, { passive: false });
    stage.addEventListener('touchcancel', onTouchEnd, { passive: false });

    return () => {
      stage.removeEventListener('touchstart', onTouchStart);
      stage.removeEventListener('touchmove', onTouchMove);
      stage.removeEventListener('touchend', onTouchEnd);
      stage.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [src]);

  if (!src) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-[420px] flex-col items-center gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          ref={stageRef}
          className="relative w-full overflow-hidden rounded-2xl bg-black shadow-float"
          style={{
            aspectRatio: '3 / 4',
            maxHeight: '78vh',
            touchAction: 'none',
            WebkitUserSelect: 'none',
            userSelect: 'none',
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleZoom();
          }}
          onWheel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
          }}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const s = state.current;
            if (s.scale <= 1.05) return;
            s.mode = 'mouse';
            s.moved = false;
            s.pointerX = e.clientX;
            s.pointerY = e.clientY;
            s.startX = s.x;
            s.startY = s.y;
            const onMove = (ev) => {
              const dx = ev.clientX - s.pointerX;
              const dy = ev.clientY - s.pointerY;
              if (Math.abs(dx) + Math.abs(dy) > 4) s.moved = true;
              s.x = s.startX + dx;
              s.y = s.startY + dy;
              paint();
            };
            const onUp = () => {
              s.mode = null;
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            className="h-full w-full object-cover"
            style={{
              transform: 'translate3d(0,0,0) scale(1)',
              transformOrigin: 'center center',
              willChange: 'transform',
              pointerEvents: 'none',
            }}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="h-11 w-11 rounded-full bg-white text-xl font-black text-ink shadow-soft"
            aria-label="Уменьшить"
            onClick={(e) => {
              e.stopPropagation();
              zoomBy(1 / 1.35);
            }}
          >
            −
          </button>
          <button
            type="button"
            className="h-11 rounded-full bg-white px-4 text-sm font-extrabold text-ink shadow-soft"
            onClick={(e) => {
              e.stopPropagation();
              toggleZoom();
            }}
          >
            Зум
          </button>
          <button
            type="button"
            className="h-11 w-11 rounded-full bg-white text-xl font-black text-ink shadow-soft"
            aria-label="Увеличить"
            onClick={(e) => {
              e.stopPropagation();
              zoomBy(1.35);
            }}
          >
            +
          </button>
        </div>

        {list.length > 1 && (
          <div className="flex justify-center gap-2">
            {list.map((_, idx) => (
              <button
                key={idx}
                type="button"
                aria-label={`Фото ${idx + 1}`}
                className={`h-2.5 rounded-full ${idx === i ? 'w-6 bg-white' : 'w-2.5 bg-white/55'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onIndex?.(idx);
                }}
              />
            ))}
          </div>
        )}

        <p className="text-center text-xs font-bold text-white/70">
          Два пальца или +/− · тап вне фото – закрыть
        </p>
      </div>
    </div>,
    document.body,
  );
}
