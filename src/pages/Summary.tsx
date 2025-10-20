import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, RefreshCw, Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TemplateSelect } from '@/components/TemplateSelect';
import { TaskItem } from '@/components/TaskItem';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import fflogo from '@/assets/fflogo.svg';

interface Session {
  id: string;
  title: string;
  started_at: string;
}

interface Summary {
  overview: string | null;
  key_topics: string[];
  decisions: string[];
  questions: string[];
  risks: string[];
  followups: string[];
  dates: any;
  participants: string[];
  detected_templates: string[];
}

interface Task {
  id: string;
  title: string;
  owner: string | null;
  due_at: string | null;
  status: string;
  priority: string;
  source: string;
}

const Summary = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  
  const [session, setSession] = useState<Session | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transcript, setTranscript] = useState('');
  const [templates, setTemplates] = useState<string[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  const loadData = async () => {
    if (!id) return;

    try {
      // Load session
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (sessionData) {
        setSession(sessionData);
      }

      // Load summary
      const { data: summaryData } = await supabase
        .from('summaries')
        .select('*')
        .eq('session_id', id)
        .maybeSingle();

      if (summaryData) {
        setSummary(summaryData);
        setTemplates(summaryData.detected_templates || []);
      }

      // Load tasks
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (tasksData) {
        setTasks(tasksData);
      }

      // Load transcript
      const { data: transcriptData } = await supabase
        .from('transcripts')
        .select('text')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (transcriptData) {
        setTranscript(transcriptData.map(t => t.text).join(' '));
      }
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load session data');
    }
  };

  const handleTemplatesChange = async (newTemplates: string[]) => {
    if (!id) return;
    setTemplates(newTemplates);

    try {
      setIsRefreshing(true);
      
      // Re-run analysis with new templates
      await supabase.functions.invoke('analyze-insights', {
        body: {
          sessionId: id,
          transcript,
          overrideTemplates: newTemplates,
        },
      });

      // Re-extract tasks
      await supabase.functions.invoke('extract-tasks', {
        body: {
          session_id: id,
          overwrite: true,
          template_hint: newTemplates.join('/'),
        },
      });

      await loadData();
      toast.success('Analysis refreshed');
    } catch (error) {
      console.error('Error refreshing analysis:', error);
      toast.error('Failed to refresh analysis');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    if (!id) return;
    
    try {
      setIsRefreshing(true);
      
      await supabase.functions.invoke('analyze-insights', {
        body: { sessionId: id, transcript },
      });

      await supabase.functions.invoke('extract-tasks', {
        body: { session_id: id, overwrite: true },
      });

      await loadData();
      toast.success('Analysis refreshed');
    } catch (error) {
      console.error('Error refreshing:', error);
      toast.error('Failed to refresh');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleAddTask = async () => {
    if (!newTaskTitle.trim() || !id) return;

    try {
      const { data, error } = await supabase
        .from('tasks')
        .insert({
          session_id: id,
          title: newTaskTitle,
          source: 'user',
          status: 'open',
        })
        .select()
        .single();

      if (error) throw error;
      if (data) {
        setTasks([...tasks, data]);
        setNewTaskTitle('');
        toast.success('Task added');
      }
    } catch (error) {
      console.error('Error adding task:', error);
      toast.error('Failed to add task');
    }
  };

  const handleUpdateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update(updates)
        .eq('id', taskId);

      if (error) throw error;

      setTasks(tasks.map(t => t.id === taskId ? { ...t, ...updates } : t));
      toast.success('Task updated');
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', taskId);

      if (error) throw error;

      setTasks(tasks.filter(t => t.id !== taskId));
      toast.success('Task deleted');
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task');
    }
  };

  const handleRegenerateTasks = async () => {
    if (!id) return;

    try {
      setIsRefreshing(true);
      
      await supabase.functions.invoke('extract-tasks', {
        body: { session_id: id, overwrite: true },
      });

      await loadData();
      toast.success('Tasks regenerated');
    } catch (error) {
      console.error('Error regenerating tasks:', error);
      toast.error('Failed to regenerate tasks');
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleCopyNote = () => {
    const note = `# ${session?.title || 'Recording'}

## Overview
${summary?.overview || 'No overview available'}

## Key Topics
${summary?.key_topics?.map(t => `- ${t}`).join('\n') || 'None'}

## Decisions
${summary?.decisions?.map(d => `- ${d}`).join('\n') || 'None'}

## Action Items
${tasks.filter(t => t.status === 'open').map(t => `- [ ] ${t.title}${t.owner ? ` (@${t.owner})` : ''}`).join('\n') || 'None'}

## Transcript
${transcript}
`;
    
    navigator.clipboard.writeText(note);
    toast.success('Note copied to clipboard');
  };

  if (!session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
          >
            <ChevronLeft size={24} />
          </Button>
          <img src={fflogo} alt="Firefly" className="h-7 opacity-90" />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
        </Button>
      </header>

      <div className="p-4 space-y-4">
        <TemplateSelect
          selectedTemplates={templates}
          onTemplatesChange={handleTemplatesChange}
        />

        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4 mt-4">
            {summary?.overview && (
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{summary.overview}</p>
                </CardContent>
              </Card>
            )}

            {tasks.filter(t => t.status === 'open' && t.source === 'ai').length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Action Items</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {tasks
                    .filter(t => t.status === 'open' && t.source === 'ai')
                    .map(task => (
                      <div key={task.id} className="text-sm">• {task.title}</div>
                    ))}
                </CardContent>
              </Card>
            )}

            {summary?.key_topics && summary.key_topics.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Key Topics</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {summary.key_topics.map((topic, i) => (
                      <li key={i}>• {topic}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {summary?.decisions && summary.decisions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Decisions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {summary.decisions.map((decision, i) => (
                      <li key={i}>• {decision}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {summary?.questions && summary.questions.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Questions</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {summary.questions.map((question, i) => (
                      <li key={i}>• {question}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {summary?.dates && summary.dates.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Important Dates</CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {summary.dates.map((date: any, i) => (
                      <li key={i}>• {date.date}: {date.context}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {summary?.participants && summary.participants.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Participants</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {summary.participants.map((participant, i) => (
                      <span key={i} className="px-3 py-1 bg-muted rounded-full text-sm">
                        {participant}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="tasks" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Input
                placeholder="Quick add"
                value={newTaskTitle}
                onChange={(e) => setNewTaskTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddTask()}
              />
              <Button onClick={handleRegenerateTasks} variant="outline" disabled={isRefreshing}>
                Regenerate from transcript
              </Button>
            </div>

            {tasks.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-muted-foreground text-center">
                    No tasks yet. Generate from transcript or add your first task.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {tasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    onUpdate={handleUpdateTask}
                    onDelete={handleDeleteTask}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transcript" className="mt-4">
            <Card>
              <CardContent className="pt-6">
                {transcript ? (
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {transcript}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center">
                    No transcript available
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 pt-4 pb-8">
          <Button onClick={handleCopyNote} variant="outline" className="flex-1">
            <Copy size={16} className="mr-2" />
            Copy Note
          </Button>
          <Button variant="outline" className="flex-1">
            <Download size={16} className="mr-2" />
            Export PDF
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Summary;
