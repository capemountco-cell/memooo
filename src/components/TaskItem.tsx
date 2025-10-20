import { useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Trash2, Star } from 'lucide-react';
import { format } from 'date-fns';

interface Task {
  id: string;
  title: string;
  owner: string | null;
  due_at: string | null;
  status: string;
  priority: string;
}

interface TaskItemProps {
  task: Task;
  onUpdate: (id: string, updates: Partial<Task>) => void;
  onDelete: (id: string) => void;
}

export const TaskItem = ({ task, onUpdate, onDelete }: TaskItemProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(task.title);

  const handleCheckChange = (checked: boolean) => {
    onUpdate(task.id, { status: checked ? 'done' : 'open' });
  };

  const handleTitleBlur = () => {
    if (editedTitle.trim() && editedTitle !== task.title) {
      onUpdate(task.id, { title: editedTitle });
    }
    setIsEditing(false);
  };

  const togglePriority = () => {
    const newPriority = task.priority === 'high' ? 'normal' : 'high';
    onUpdate(task.id, { priority: newPriority });
  };

  return (
    <div className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg group">
      <Checkbox
        checked={task.status === 'done'}
        onCheckedChange={handleCheckChange}
        className="mt-1"
      />
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <Input
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleBlur();
              if (e.key === 'Escape') {
                setEditedTitle(task.title);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="h-8"
          />
        ) : (
          <button
            onClick={() => setIsEditing(true)}
            className="text-left w-full text-sm font-medium hover:text-primary transition-colors"
          >
            {task.title}
          </button>
        )}
        {(task.owner || task.due_at) && (
          <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
            {task.owner && <span>{task.owner}</span>}
            {task.due_at && <span>{format(new Date(task.due_at), 'MMM d')}</span>}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={togglePriority}
          className={`p-1.5 rounded hover:bg-background/50 transition-colors ${
            task.priority === 'high' ? 'text-yellow-500' : 'text-muted-foreground'
          }`}
          aria-label="Toggle priority"
        >
          <Star size={14} fill={task.priority === 'high' ? 'currentColor' : 'none'} />
        </button>
        <button
          onClick={() => onDelete(task.id)}
          className="p-1.5 rounded hover:bg-background/50 text-muted-foreground hover:text-destructive transition-colors"
          aria-label="Delete task"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
};
