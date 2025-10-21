import React from "react";

interface ProgressBarProps {
  value: number;
  label: string;
}

export default function ProgressBar({ value, label }: ProgressBarProps) {
  const v = Math.max(0, Math.min(100, value | 0));
  return (
    <div className="w-full max-w-[720px] mx-auto">
      <div className="text-center mb-2 text-sm text-white/90">{label} · {v}%</div>
      <div className="h-3 w-full bg-white/10 rounded-full overflow-hidden">
        <div 
          className="h-full bg-white transition-[width] duration-300" 
          style={{ width: `${v}%` }} 
        />
      </div>
    </div>
  );
}
