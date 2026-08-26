interface WordmarkProps {
  className?: string;
}

/** The "memo" text wordmark. Size and colour come from the caller. */
export const Wordmark = ({ className = '' }: WordmarkProps) => (
  <span className={`font-semibold tracking-tight select-none ${className}`}>memo</span>
);
