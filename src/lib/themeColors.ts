/**
 * Full-bleed page backgrounds, kept in one place so the browser chrome
 * (iOS status bar / address bar) and the overscroll area can be painted to
 * match whatever view is on screen.
 */
export const THEME_COLORS = {
  /** Idle / processing screens and the home screen. */
  black: '#000000',
  /** Actively recording. */
  recording: '#E34843',
  /** Recording paused. */
  paused: '#F5B547',
  /** Light content surfaces (summary, shared session). */
  surface: '#FFFFFF',
} as const;

export type ThemeColor = (typeof THEME_COLORS)[keyof typeof THEME_COLORS];
