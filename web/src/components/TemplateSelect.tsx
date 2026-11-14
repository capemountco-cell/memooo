import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

const TEMPLATES = [
  'Standup', '1-on-1', 'User Interview', 'Customer Discovery',
  'Pitch', 'Planning', 'Retro', 'Brainstorm', 'Status Update',
  'Hiring Interview', 'Support Call', 'Training', 'Other'
];

interface TemplateSelectProps {
  selectedTemplates: string[];
  onTemplatesChange: (templates: string[]) => void;
}

export const TemplateSelect = ({ selectedTemplates, onTemplatesChange }: TemplateSelectProps) => {
  const [open, setOpen] = useState(false);

  const toggleTemplate = (template: string) => {
    if (selectedTemplates.includes(template)) {
      onTemplatesChange(selectedTemplates.filter(t => t !== template));
    } else {
      if (selectedTemplates.length < 2) {
        onTemplatesChange([...selectedTemplates, template]);
      }
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {selectedTemplates.map(template => (
        <button
          key={template}
          onClick={() => toggleTemplate(template)}
          className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {template}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="rounded-full">
            <Plus className="w-4 h-4 mr-2" />
            Add Template
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80">
          <div className="space-y-2">
            {TEMPLATES.map(template => (
              <button
                key={template}
                onClick={() => {
                  toggleTemplate(template);
                  if (selectedTemplates.length >= 1) setOpen(false);
                }}
                disabled={selectedTemplates.includes(template)}
                className="w-full text-left px-4 py-2 rounded-lg hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {template}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
