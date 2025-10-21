import { X } from 'lucide-react';
import { format } from 'date-fns';
import { useState, useRef } from 'react';

interface SessionCardProps {
  id: string;
  title: string;
  startedAt: string;
  durationSeconds: number | null;
  onDelete: (id: string) => void;
  onClick: () => void;
}

export const SessionCard = ({ id, title, startedAt, durationSeconds, onDelete, onClick }: SessionCardProps) => {
  const [isDeleting, setIsDeleting] = useState(false);
  const deleteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressRef = useRef<number>(0);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  const handleDeleteStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDeleting(true);
    progressRef.current = 0;

    deleteTimerRef.current = setTimeout(() => {
      onDelete(id);
      setIsDeleting(false);
    }, 800); // 800ms hold duration
  };

  const handleDeleteEnd = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
    }
    setIsDeleting(false);
  };

  return (
    <div
      onClick={onClick}
      className="relative flex items-start justify-between gap-3 p-4 bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 rounded-2xl hover:bg-primary-foreground/15 transition-all cursor-pointer"
    >
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-primary-foreground line-clamp-2 leading-snug">
          {title || 'Untitled Recording'}
        </h3>
        <div className="flex items-center gap-4 mt-2 text-xs text-primary-foreground/70">
          <span>{format(new Date(startedAt), 'h:mm a')}</span>
          <span>{formatDuration(durationSeconds)}</span>
        </div>
      </div>
      <button
        onMouseDown={handleDeleteStart}
        onMouseUp={handleDeleteEnd}
        onMouseLeave={handleDeleteEnd}
        onTouchStart={handleDeleteStart}
        onTouchEnd={handleDeleteEnd}
        className={`relative flex-shrink-0 text-primary-foreground hover:text-primary transition-colors p-2 ${
          isDeleting ? 'scale-110' : ''
        }`}
        aria-label="Hold to delete recording"
      >
        <X size={20} />
        {isDeleting && (
          <div className="absolute inset-0 rounded-full border-2 border-destructive animate-pulse" />
        )}
      </button>
    </div>
  );
};
