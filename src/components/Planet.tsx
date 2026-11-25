import { useId } from 'react';

/**
 * The planet: banded atmosphere, a dark storm spot and a thin tilted ring.
 * Colours come from theme CSS variables, so every planet theme recolours it.
 */
export function Planet({ size = 240, spin = false, className = '' }: { size?: number; spin?: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg
      className={`planet ${spin ? 'planet-spin' : ''} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 200 200"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={`body-${id}`} cx="36%" cy="30%" r="78%">
          <stop offset="0" stopColor="var(--p-light)" />
          <stop offset="0.5" stopColor="var(--p-mid)" />
          <stop offset="1" stopColor="var(--p-deep)" />
        </radialGradient>
        <radialGradient id={`shade-${id}`} cx="30%" cy="28%" r="85%">
          <stop offset="0.55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.55" />
        </radialGradient>
        <clipPath id={`clip-${id}`}>
          <circle cx="100" cy="100" r="64" />
        </clipPath>
      </defs>
      {/* back half of the ring */}
      <ellipse cx="100" cy="104" rx="96" ry="20" fill="none" stroke="var(--p-ring)" strokeOpacity="0.35" strokeWidth="1.4" transform="rotate(-14 100 104)" />
      <circle cx="100" cy="100" r="64" fill={`url(#body-${id})`} />
      <g clipPath={`url(#clip-${id})`} className="planet-bands">
        <path d="M20 70 Q100 58 180 72 L180 80 Q100 68 20 78Z" fill="var(--p-light)" opacity="0.22" />
        <path d="M20 96 Q100 88 180 98 L180 103 Q100 94 20 102Z" fill="var(--p-deep)" opacity="0.35" />
        <path d="M20 120 Q100 112 180 124 L180 132 Q100 120 20 128Z" fill="var(--p-light)" opacity="0.16" />
        <path d="M20 146 Q100 140 180 150 L180 156 Q100 148 20 154Z" fill="var(--p-deep)" opacity="0.3" />
        <ellipse cx="78" cy="118" rx="15" ry="8" fill="var(--p-spot)" opacity="0.75" />
        <ellipse cx="84" cy="111" rx="11" ry="2.2" fill="var(--p-ring)" opacity="0.55" />
        <path d="M118 78 q14 -3 26 2" stroke="var(--p-ring)" strokeOpacity="0.5" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
      <circle cx="100" cy="100" r="64" fill={`url(#shade-${id})`} />
      {/* front half of the ring */}
      <path d="M4 104 A96 20 0 0 0 196 104" fill="none" stroke="var(--p-ring)" strokeOpacity="0.7" strokeWidth="1.6" transform="rotate(-14 100 104)" />
      {/* a small moon */}
      <circle cx="176" cy="44" r="5" fill="var(--triton)" />
    </svg>
  );
}

export function Brand({ name }: { name?: string }) {
  return (
    <span className="brand">
      <Planet size={34} />
      <span className="brand-text">
        <span className="brand-name">{name ?? 'Team Neptune'}</span>
        <span className="brand-sub">planning poker</span>
      </span>
    </span>
  );
}
