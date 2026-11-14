interface TimerProps {
  seconds: number;
}

export const Timer = ({ seconds }: TimerProps) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return (
    <div className="text-8xl font-bold text-primary-foreground tracking-wider">
      {String(minutes).padStart(2, '0')}:{String(remainingSeconds).padStart(2, '0')}
    </div>
  );
};
