interface RecordButtonProps {
  isRecording: boolean;
  onClick: () => void;
}

export const RecordButton = ({ isRecording, onClick }: RecordButtonProps) => {
  return (
    <button
      onClick={onClick}
      className="group relative flex items-center justify-center w-64 h-64 rounded-full bg-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 hover:bg-foreground/15 transition-all duration-300"
      aria-label={isRecording ? "Stop recording" : "Start recording"}
    >
      <div className={`w-32 h-32 rounded-full ${isRecording ? 'bg-primary animate-pulse' : 'bg-primary'} transition-all duration-300`} />
    </button>
  );
};
