type SpinnerProps = {
  className?: string;
};

export default function Spinner({ className = "" }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="読み込み中"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
