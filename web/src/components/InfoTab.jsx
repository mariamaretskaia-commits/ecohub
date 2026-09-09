import Sticker from './Sticker';
import BrandMark from './BrandMark';

function LinkWord({ children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-extrabold text-mint-700 underline underline-offset-2 decoration-mint-300 active:opacity-70"
    >
      {children}
    </button>
  );
}

export default function InfoTab({ onChangeTab }) {
  return (
    <div className="px-4 pt-2 pb-8 space-y-4">
      <div className="card p-5 bg-gradient-to-br from-mint-100 to-sun-50">
        <Sticker name="logo" size={88} className="mx-auto mb-2" />
        <h2 className="text-center">
          <BrandMark size="lg" />
        </h2>
        <p className="type-body text-center mt-2">
          – сервис, где ненужные вещи отдают{' '}
          <LinkWord onClick={() => onChangeTab?.('feed')}>даром</LinkWord>
          {' '}другим людям.
          <br />
          А на{' '}
          <LinkWord onClick={() => onChangeTab?.('map')}>карте</LinkWord>
          {' '}– пункты приёма и переработки.
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sticker name="share" size={32} />
          <h3 className="type-title">Как отдать или взять вещь?</h3>
        </div>
        <ul className="space-y-3">
          <Thesis
            title="1. Отдать"
            text={(
              <>
                Откройте{' '}
                <LinkWord onClick={() => onChangeTab?.('profile')}>«Профиль»</LinkWord>
                {' '}→ «+ Добавить». Объявление появится в{' '}
                <LinkWord onClick={() => onChangeTab?.('feed')}>«Даром»</LinkWord>
                .
              </>
            )}
          />
          <Thesis
            title="2. Взять"
            text={(
              <>
                В{' '}
                <LinkWord onClick={() => onChangeTab?.('feed')}>«Даром»</LinkWord>
                {' '}нажмите «Хочу взять» – откроется{' '}
                <LinkWord onClick={() => onChangeTab?.('chat')}>«Чат»</LinkWord>
                .
              </>
            )}
          />
          <Thesis
            title="3. Договориться"
            text={(
              <>
                Пишите друг другу в{' '}
                <LinkWord onClick={() => onChangeTab?.('chat')}>«Чате»</LinkWord>
                . Если вас нет в приложении, бот @EcoHubBY_bot напомнит о сообщении.
              </>
            )}
          />
        </ul>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sticker name="pin" size={32} />
          <h3 className="type-title">Что на карте?</h3>
        </div>
        <p className="type-body mb-3">
          Выберите, что сдаёте – увидите подходящие пункты. Типы на карте:
        </p>
        <ul className="space-y-3">
          <Thesis
            title="Пункт переработки"
            text="Принимают сырьё и платят по прайсу."
          />
          <Thesis
            title="Центр помощи"
            text="Принимают вещи для нуждающихся бесплатно, в часы работы."
          />
          <Thesis
            title="Контейнер"
            text="Можно положить вещи самостоятельно в любое время."
          />
        </ul>
        <p className="type-meta mt-3">
          Открыть{' '}
          <LinkWord onClick={() => onChangeTab?.('map')}>«Карту»</LinkWord>
        </p>
      </div>

      <div className="text-center type-meta py-3">
        <p>Конкурс «100 идей для Беларуси»</p>
        <p className="mt-1">Республика Беларусь · 2026</p>
      </div>
    </div>
  );
}

function Thesis({ title, text }) {
  return (
    <li className="flex gap-2.5 items-start">
      <span className="mt-[7px] h-2 w-2 rounded-full bg-mint-500 shrink-0" />
      <div>
        <p className="type-label">{title}</p>
        <p className="type-meta mt-0.5">{text}</p>
      </div>
    </li>
  );
}
