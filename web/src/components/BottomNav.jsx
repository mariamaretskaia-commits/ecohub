import Sticker from './Sticker';

const TABS = [
  { id: 'profile', sticker: 'person', label: 'Профиль' },
  { id: 'feed', sticker: 'share', label: 'Даром' },
  { id: 'chat', sticker: 'chat', label: 'Чат' },
  { id: 'map', sticker: 'pin', label: 'Карта' },
  { id: 'info', sticker: 'info', label: 'О проекте' },
];

export default function BottomNav({ active, onChange, chatUnread = 0 }) {
  return (
    <nav className="fixed bottom-4 left-0 right-0 z-50 px-3">
      <div className="max-w-lg mx-auto card px-1.5 py-1.5 grid grid-cols-5 gap-1">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`relative min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 px-0.5 rounded-2xl transition-colors ${
                isActive ? 'bg-mint-100' : ''
              }`}
            >
              <Sticker
                name={tab.sticker}
                size={28}
                className={isActive ? '' : 'opacity-65'}
              />
              {tab.id === 'chat' && chatUnread > 0 && (
                <span
                  className="absolute top-1 right-1/2 translate-x-[14px] h-2.5 w-2.5 rounded-full bg-mint-500 border-2 border-white shadow-sm"
                  aria-label="Непрочитанные сообщения"
                />
              )}
              <span
                className={`w-full text-[10px] leading-tight font-extrabold text-center truncate ${
                  isActive ? 'text-mint-700' : 'text-ink/40'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
