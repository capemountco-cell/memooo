import { CAPTAIN_PATH, CAPTAIN_VIEWBOX } from '@/assets/captainWordmark';

interface WordmarkProps {
  className?: string;
}

/**
 * The Captain signature. It is sized by the caller's text size (its height
 * follows the font size) and takes the text colour, so the same classes that
 * styled the old text wordmark still work.
 */
export const Wordmark = ({ className = '' }: WordmarkProps) => (
  <svg
    viewBox={CAPTAIN_VIEWBOX}
    fill="currentColor"
    role="img"
    aria-label="Captain"
    className={`select-none ${className}`}
    style={{ height: '1.15em', width: 'auto' }}
  >
    <path fillRule="evenodd" d={CAPTAIN_PATH} />
  </svg>
);
