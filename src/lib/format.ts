/** Display helpers. No decisions about notes live here, only how to print them. */

/** "4:05", or "1:02:03" past an hour. Mirrors memo_core::clock. */
export function clock(totalSecs: number): string {
  const secs = Math.max(0, Math.floor(totalSecs));
  const hours = Math.floor(secs / 3600);
  const minutes = Math.floor(secs / 60) % 60;
  const seconds = String(secs % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** "28 min", "1 h 5 min", or "" for nothing recorded. */
export function length(totalSecs: number): string {
  if (totalSecs < 60) return totalSecs > 0 ? "<1 min" : "";
  const minutes = Math.round(totalSecs / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** "Today", "Yesterday", "Mon 10", or "3 Mar 2025" for older years. */
export function dayLabel(ms: number, now: Date = new Date()): string {
  const date = new Date(ms);
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days > 1 && days < 7) return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function greeting(now: Date = new Date()): string {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
