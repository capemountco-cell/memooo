export type RecState = "idle" | "initializing" | "recording" | "paused" | "processing" | "error";

export const bgFor = (s: RecState) =>
  s === "recording" ? "bg-[#E34843]"
  : s === "paused" ? "bg-[#F5B547]"
  : "bg-black";
