/**
 * The NxtWave Attendance mark: an N with a check badge. onDark draws it on a
 * white tile for the navy headers; otherwise it is the navy tile used as the
 * browser icon (app/icon.svg).
 */
export function Logo({ onDark, className = "size-8" }: { onDark?: boolean; className?: string }) {
  const tile = onDark ? "#FFFFFF" : "#1E3A5F";
  const letter = onDark ? "#1E3A5F" : "#FFFFFF";
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="NxtWave Attendance">
      <rect width="32" height="32" rx="7" fill={tile} />
      <path d="M7.5 23.5V8.5h3.2l7.6 9.6V8.5h3.2v15h-3.2l-7.6-9.6v9.6z" fill={letter} />
      <circle cx="24.5" cy="24.5" r="6" fill="#16A34A" stroke={tile} strokeWidth="1.5" />
      <path d="M21.8 24.6l1.9 1.9 3.6-3.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
