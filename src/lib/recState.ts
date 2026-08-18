import { THEME_COLORS } from "./themeColors";

export type RecState = "idle" | "initializing" | "recording" | "paused" | "processing" | "error";

export const bgFor = (s: RecState) =>
  s === "recording" ? "bg-[#E34843]"
  : s === "paused" ? "bg-[#F5B547]"
  : "bg-black";

/** The literal colour behind `bgFor`, for painting the browser chrome. */
export const themeColorFor = (s: RecState) =>
  s === "recording" ? THEME_COLORS.recording
  : s === "paused" ? THEME_COLORS.paused
  : THEME_COLORS.black;
