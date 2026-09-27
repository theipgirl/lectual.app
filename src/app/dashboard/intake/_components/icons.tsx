/**
 * The five line icons the canvas uses, transcribed from its inline SVG. All
 * stroke `currentColor`, so they take the colour of whatever chip or button
 * they sit in and there is no icon-specific token to keep in sync.
 */

type IconProps = { size?: number };

function Svg({ size = 13, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      aria-hidden
      focusable="false"
      style={{ flex: "0 0 auto" }}
    >
      {children}
    </svg>
  );
}

export function ImportIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
    </Svg>
  );
}

export function TableIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Svg>
  );
}

export function BoardIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 5h5v14H4zM15 5h5v9h-5z" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l4 4" />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 10l5 5 5-5" />
    </Svg>
  );
}
