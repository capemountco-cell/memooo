/** Inline stroke icons, so they follow the text colour in both themes. */

type IconProps = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const SearchIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const BackIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
);

export const HomeIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
  </svg>
);

export const NoteIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 3h9l5 5v13H6z" />
    <path d="M14 3v6h6" />
  </svg>
);

export const PauseIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
);

export const PlayIcon = ({ size = 12 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M7 5v14l12-7z" />
  </svg>
);

export const CollapseIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 14h6v6M20 10h-6V4" />
  </svg>
);

export const ExpandIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M14 4h6v6M10 20H4v-6" />
  </svg>
);

export const PopOutIcon = ({ size = 15 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3" y="11" width="10" height="10" rx="2" />
    <path d="M13 3h8v8M21 3l-9 9" />
  </svg>
);

export const CloseIcon = ({ size = 13 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);
