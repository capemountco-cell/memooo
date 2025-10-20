import { X } from 'lucide-react';
import { format } from 'date-fns';

interface SessionCardProps {
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number | null;
  onDelete: (id: string) => void;
  onClick: () => void;
}

export const SessionCard = ({ id, title, startedAt, durationSeconds, onDelete, onClick }: SessionCardProps) => {
  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div
      onClick={onClick}
      className="relative flex items-center justify-between p-4 bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 rounded-2xl hover:bg-primary-foreground/15 transition-all cursor-pointer"
    >
      <div className="flex-1">
        <h3 className="text-lg font-semibold text-primary-foreground">{title || 'Untitled Recording'}</h3>
        <div className="flex items-center gap-4 mt-1 text-sm text-primary-foreground/70">
          <span>{format(new Date(startedAt), 'h:mm a')}</span>
          <span>{formatDuration(durationSeconds)}</span>
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(id);
        }}
        className="text-primary-foreground hover:text-primary transition-colors p-2"
        aria-label="Delete recording"
      >
        <X size={20} />
      </button>
    </div>
  );
};
