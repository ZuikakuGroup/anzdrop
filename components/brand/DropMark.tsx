type DropMarkProps = {
  className?: string;
};

export default function DropMark({ className = "" }: DropMarkProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <path
        d="M12 2c3.6 4.6 6.5 8.53 6.5 12a6.5 6.5 0 1 1-13 0C5.5 10.53 8.4 6.6 12 2Z"
        fill="currentColor"
      />
    </svg>
  );
}
