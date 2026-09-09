import { useId } from 'react';

export default function BrandMark({ size = 'md', className = '', animate = false }) {
  const strokeId = `brand-stroke-${useId().replace(/:/g, '')}`;
  const rootClass = [
    'brand-mark',
    `brand-mark--${size}`,
    animate ? 'brand-mark--animate' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={rootClass} aria-label="EcoHub">
      <span className="brand-mark__word">
        <span className="brand-mark__eco">Eco</span>
        <span className="brand-mark__hub">Hub</span>
      </span>
      <svg
        className="brand-mark__path"
        viewBox="0 0 120 10"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={strokeId} x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#2fb66a" stopOpacity="0.15" />
            <stop offset="18%" stopColor="#2fb66a" stopOpacity="1" />
            <stop offset="55%" stopColor="#5fc987" stopOpacity="1" />
            <stop offset="82%" stopColor="#f5c542" stopOpacity="1" />
            <stop offset="100%" stopColor="#f5c542" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <path
          className="brand-mark__path-line"
          d="M6 7 C42 2.4, 78 2.4, 114 7"
          fill="none"
          stroke={`url(#${strokeId})`}
          strokeWidth="2.2"
          strokeLinecap="round"
          pathLength="1"
        />
      </svg>
    </span>
  );
}
