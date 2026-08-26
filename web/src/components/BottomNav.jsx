import Sticker from './Sticker';

const TABS = [
  { id: 'profile', sticker: 'person', label: 'Профиль' },
  { id: 'feed', sticker: 'share', label: 'Даром' },
  { id: 'map', sticker: 'pin', label: 'Переработка' },
  { id: 'info', sticker: 'info', label: 'О проекте' },
];

export default function BottomNav({ active, onChange }) {
  return (
    <nav className="fixed bottom-4 left-0 right-0 z-50 px-4">
      <div className="max-w-lg mx-auto card px-2 py-2 flex">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onChange(tab.id)}
              className={`flex-1 flex flex-col items-center py-1.5 rounded-2xl transition-all ${
                isActive ? 'bg-mint-100' : ''
              }`}
            >
              <Sticker name={tab.sticker} size={isActive ? 36 : 32} className={isActive ? '' : 'opacity-70'} />
              <span className={`text-xs font-extrabold mt-0.5 ${isActive ? 'text-mint-700' : 'text-ink/40'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
