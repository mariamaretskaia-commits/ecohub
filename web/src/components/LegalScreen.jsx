import { createPortal } from 'react-dom';
import { LEGAL_DOCS } from '../legal';

function Section({ section }) {
  return (
    <section className="mb-5">
      <h4 className="type-title mb-2">{section.h}</h4>
      {section.intro && <p className="type-body mb-1.5">{section.intro}</p>}
      {section.items && (
        <div className="space-y-1.5">
          {section.items.map((t, i) => (
            <p key={i} className="type-body">{t}</p>
          ))}
        </div>
      )}
      {section.list && (
        <ul className="mt-1.5 space-y-1.5">
          {section.list.map((t, i) => (
            <li key={i} className="flex gap-2 items-start type-body">
              <span className="mt-[8px] h-1.5 w-1.5 rounded-full bg-mint-500 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      {section.after && (
        <div className="mt-1.5 space-y-1.5">
          {section.after.map((t, i) => (
            <p key={i} className="type-body">{t}</p>
          ))}
        </div>
      )}
      {section.list2 && (
        <ul className="mt-1.5 space-y-1.5">
          {section.list2.map((t, i) => (
            <li key={i} className="flex gap-2 items-start type-body">
              <span className="mt-[8px] h-1.5 w-1.5 rounded-full bg-mint-500 shrink-0" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      {section.after2 && (
        <div className="mt-1.5 space-y-1.5">
          {section.after2.map((t, i) => (
            <p key={i} className="type-body">{t}</p>
          ))}
        </div>
      )}
      {section.footnote && <p className="type-meta mt-2">{section.footnote}</p>}
    </section>
  );
}

export default function LegalScreen({ docId, onClose, onAgree }) {
  const doc = LEGAL_DOCS[docId];

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-white" role="dialog" aria-modal="true">
      <header className="sticky top-0 z-10 border-b border-mint-100/80 bg-white/95 backdrop-blur px-4 py-3">
        <div className="mx-auto flex max-w-lg items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mint-50 text-xl font-black text-ink active:bg-mint-100"
            aria-label="Назад"
          >
            ‹
          </button>
          <div className="min-w-0">
            <h3 className="type-title leading-tight truncate">{doc.title}</h3>
            {doc.subtitle && <p className="type-kicker leading-tight">{doc.subtitle}</p>}
            {doc.edition && <p className="type-kicker leading-tight opacity-70">{doc.edition}</p>}
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto max-w-lg">
          {doc.sections.map((section, i) => (
            <Section key={i} section={section} />
          ))}
        </div>
      </div>

      {onAgree && (
        <footer className="sticky bottom-0 z-10 border-t border-mint-100/80 bg-white/95 backdrop-blur px-4 py-3">
          <div className="mx-auto max-w-lg">
            <button type="button" className="btn-primary w-full" onClick={onAgree}>
              Согласен с условиями
            </button>
          </div>
        </footer>
      )}
    </div>,
    document.body,
  );
}