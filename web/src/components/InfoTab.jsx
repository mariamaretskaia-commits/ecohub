import Sticker from './Sticker';
import BrandMark from './BrandMark';

export default function InfoTab() {
  return (
    <div className="px-4 pt-2 pb-8 space-y-4">
      <div className="card p-5 bg-gradient-to-br from-mint-100 to-sun-50">
        <Sticker name="logo" size={88} className="mx-auto mb-2" />
        <h2 className="text-center">
          <BrandMark size="lg" />
        </h2>
        <p className="type-body text-center mt-2">
          Передайте вещь человеку даром. Если так нельзя – пункты сортировки и контейнеры на карте.
        </p>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sticker name="phone" size={32} />
          <h3 className="type-title">Как связаться?</h3>
        </div>
        <ul className="space-y-3">
          <Thesis
            title="Выложить вещь"
            text="Профиль → Мои объявления → «+ Добавить». Объявление видят все, кто открыл EcoHub."
          />
          <Thesis
            title="Хочу взять"
            text="Откроется переписка в разделе «Чат» в приложении. Личные профили Telegram не показываем."
          />
          <Thesis
            title="Уведомления"
            text="Если вы не в приложении, бот напомнит о новых сообщениях и предложит открыть раздел «Чат»."
          />
          <Thesis
            title="Оба жмут /start"
            text="Бот доставляет уведомления только тем, кто хотя бы раз открыл @EcoHubBY_bot."
          />
        </ul>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sticker name="pin" size={32} />
          <h3 className="type-title">Что на карте?</h3>
        </div>
        <ul className="space-y-3">
          <Thesis
            title="Касса"
            text="Сырьё принимает сотрудник, оплата по прайсу на месте."
          />
          <Thesis
            title="Приёмка"
            text="Вещи принимают как благотворительность, в часы работы пункта."
          />
          <Thesis
            title="Контейнер"
            text="Железный бак: вещи можно пожертвовать самостоятельно."
          />
          <Thesis
            title="Звонок в один тап"
            text="Номер открывается в наборе. Сайт – рядом."
          />
        </ul>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-2 mb-3">
          <Sticker name="recycle" size={32} />
          <h3 className="type-title">Зачем это нужно?</h3>
        </div>
        <ul className="space-y-3">
          <Thesis
            title="Получить деньги за сырьё"
            text="Партнёры платят за макулатуру, металл, технику и АКБ."
          />
          <Thesis
            title="Помочь людям"
            text="Отдайте лишнее даром – заберут те, кому нужно."
          />
          <Thesis
            title="Сортировать легко"
            text="Когда ясно, куда нести бумагу, технику или одежду, сдача по категориям становится простой и бережёт природу."
          />
        </ul>
      </div>

      <div className="text-center type-meta py-3">
        <p>Конкурс «100 идей для Беларуси»</p>
        <p className="mt-1">Беларусь · 2026</p>
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
