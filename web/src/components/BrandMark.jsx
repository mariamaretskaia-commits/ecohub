export default function BrandMark({ size = 'md', className = '' }) {
  return (
    <span
      className={`brand-mark brand-mark--${size}${className ? ` ${className}` : ''}`}
      aria-label="EcoHub"
    >
      EcoHub
    </span>
  );
}
