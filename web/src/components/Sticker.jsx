const STICKERS = {
  logo: '/stickers/sticker-logo.png?v=1',
  bin: '/stickers/sticker-bin.png?v=2',
  coin: '/stickers/sticker-coin.png?v=2',
  recycle: '/stickers/sticker-recycle.png?v=2',
  share: '/stickers/sticker-share.png?v=2',
  sprout: '/stickers/sticker-sprout.png?v=2',
  person: '/stickers/sticker-person.png?v=1',
  pin: '/stickers/sticker-pin.png?v=2',
  paper: '/stickers/sticker-paper.png?v=2',
  listing: '/stickers/sticker-listing.png?v=2',
  favorite: '/stickers/sticker-favorite.png?v=7',
  electronics: '/stickers/sticker-tech.png?v=2',
  clothing: '/stickers/sticker-clothes.png?v=2',
  hazardous: '/stickers/sticker-battery.png?v=2',
  metal: '/stickers/sticker-metal.png?v=2',
  clock: '/stickers/sticker-clock.png?v=1',
  phone: '/stickers/sticker-phone.png?v=1',
  globe: '/stickers/sticker-globe.png?v=1',
  bus: '/stickers/sticker-bus.png?v=1',
  truck: '/stickers/sticker-truck.png?v=1',
  info: '/stickers/sticker-info.png?v=1',
  crownGold: '/stickers/sticker-crown-gold.png?v=1',
  crownSilver: '/stickers/sticker-crown-silver.png?v=1',
  crownBronze: '/stickers/sticker-crown-bronze.png?v=1',
};

export default function Sticker({ name, size = 56, className = '', alt = '' }) {
  return (
    <img
      src={STICKERS[name]}
      alt={alt || name}
      width={size}
      height={size}
      style={{ width: size, height: size, maxWidth: size, maxHeight: size }}
      className={`object-contain object-center bg-transparent select-none shrink-0 ${className}`}
      draggable={false}
    />
  );
}

export { STICKERS };
