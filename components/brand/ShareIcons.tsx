type IconProps = {
  className?: string;
};

export function XIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5 5l14 14M19 5L5 19"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function CheckIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M5 13l4 4L19 7"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function InstagramIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <rect
        x={3.5}
        y={3.5}
        width={17}
        height={17}
        rx={5}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
      <circle
        cx={12}
        cy={12}
        r={4.2}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
      <circle cx={17.2} cy={6.8} r={1.1} fill="currentColor" />
    </svg>
  );
}

export function EyeIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        fill="none"
      />
      <circle
        cx={12}
        cy={12}
        r={2.6}
        stroke="currentColor"
        strokeWidth={2}
        fill="none"
      />
    </svg>
  );
}

export function EyeOffIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3.5 3.5l17 17M6.4 6.6C4.3 8 2.7 10 2 12c0 0 3.6 6.5 10 6.5 2.1 0 3.9-.6 5.4-1.5M10.3 5.7c.7-.1 1.4-.2 2.2-.2 6.4 0 10 6.5 10 6.5-.5 1-1.3 2.3-2.4 3.5"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9.9 10c-.3.5-.4 1-.4 1.6 0 1.5 1.2 2.7 2.7 2.7.5 0 1-.1 1.4-.4"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function QrCodeIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <rect x={3} y={3} width={7} height={7} rx={1} stroke="currentColor" strokeWidth={2} fill="none" />
      <rect x={14} y={3} width={7} height={7} rx={1} stroke="currentColor" strokeWidth={2} fill="none" />
      <rect x={3} y={14} width={7} height={7} rx={1} stroke="currentColor" strokeWidth={2} fill="none" />
      <rect x={5.5} y={5.5} width={2} height={2} fill="currentColor" />
      <rect x={16.5} y={5.5} width={2} height={2} fill="currentColor" />
      <rect x={5.5} y={16.5} width={2} height={2} fill="currentColor" />
      <rect x={14} y={14} width={3} height={3} fill="currentColor" />
      <rect x={19} y={14} width={2} height={2} fill="currentColor" />
      <rect x={14} y={19} width={2} height={2} fill="currentColor" />
      <rect x={19} y={19} width={2} height={2} fill="currentColor" />
      <rect x={17} y={17} width={2} height={2} fill="currentColor" />
    </svg>
  );
}

export function ChevronIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function LineIcon({ className = "" }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M4 11.5C4 7.36 7.8 4 12.5 4S21 7.36 21 11.5c0 3.71-3.02 6.82-7.1 7.4-.3.06-.7.2-.8.46-.1.24-.06.6-.03.85l.13.83c.04.24.2.96-.84.53-1.04-.44-5.62-3.31-7.67-5.67C4 14.36 4 13.1 4 11.5Z"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
