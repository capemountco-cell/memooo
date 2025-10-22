import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, RefreshCw, Share2, Download, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { TemplateSelect } from '@/components/TemplateSelect';
import { TaskItem } from '@/components/TaskItem';
import { Skeleton } from '@/components/ui/skeleton';
import { PinShareDialog } from '@/components/PinShareDialog';
import ProgressBar from '@/components/ProgressBar';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import jsPDF from 'jspdf';
import fflogo from '@/assets/fflogo.svg';
import { getAudioSignedUrl } from '@/utils/audioUpload';

interface Session {
  id: string;
  title: string;
  started_at: string;
  status: string;
  audio_url: string | null;
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

const formatTranscript = (raw: string) => {
  return raw.split(/\n{2,}/).map((block) => {
    const [first, ...rest] = block.split('\n');
    const cleaned = first.replace(/^\*{1,3}|\*{1,3}$/g, '');
    const isHeading = cleaned.length <= 120 && (/:$/.test(cleaned) || /^[A-Z].{0,}$/.test(cleaned));
    return { heading: isHeading ? cleaned : null, body: isHeading ? rest.join('\n') : block };
  });
};

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
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingLabel, setLoadingLabel] = useState('Loading session...');
  const [isLoading, setIsLoading] = useState(true);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [audioSignedUrl, setAudioSignedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadData();
  }, [id]);

  useEffect(() => {
    // Load signed URL for audio if available
    if (session?.audio_url) {
      getAudioSignedUrl(session.audio_url)
        .then(setAudioSignedUrl)
        .catch(err => console.error('Error loading audio URL:', err));
    }
  }, [session?.audio_url]);

  const loadData = async () => {
    if (!id) return;

    try {
      setIsLoading(true);
      setLoadingProgress(10);
      setLoadingLabel('Loading session...');

      // Load session
      const { data: sessionData } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();

      if (sessionData) {
        setSession(sessionData);
      }
      setLoadingProgress(30);

      // Load summary
      setLoadingLabel('Loading insights...');
      const { data: summaryData } = await supabase
        .from('summaries')
        .select('*')
        .eq('session_id', id)
        .maybeSingle();

      if (summaryData) {
        setSummary(summaryData);
        setTemplates(summaryData.detected_templates || []);
      }
      setLoadingProgress(60);

      // Load tasks
      setLoadingLabel('Loading tasks...');
      const { data: tasksData } = await supabase
        .from('tasks')
        .select('*')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (tasksData) {
        setTasks(tasksData);
      }
      setLoadingProgress(85);

      // Load transcript
      setLoadingLabel('Loading transcript...');
      const { data: transcriptData } = await supabase
        .from('transcripts')
        .select('text')
        .eq('session_id', id)
        .order('created_at', { ascending: true });

      if (transcriptData) {
        setTranscript(transcriptData.map(t => t.text).join(' '));
      }
      setLoadingProgress(100);
      
      // Small delay to show 100%
      setTimeout(() => setIsLoading(false), 200);
    } catch (error) {
      console.error('Error loading data:', error);
      toast.error('Failed to load session data', { duration: 1000 });
      setIsLoading(false);
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
      toast.success('Analysis refreshed', { duration: 1000 });
    } catch (error) {
      console.error('Error refreshing analysis:', error);
      toast.error('Failed to refresh analysis', { duration: 1000 });
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
      toast.success('Analysis refreshed', { duration: 1000 });
    } catch (error) {
      console.error('Error refreshing:', error);
      toast.error('Failed to refresh', { duration: 1000 });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRetryTranscription = async () => {
    if (!id || !session?.audio_url) return;
    
    try {
      setIsRefreshing(true);
      toast.info('Retrying transcription...', { duration: 2000 });
      
      // Get signed URL for the audio file
      const signedUrl = await getAudioSignedUrl(session.audio_url);
      
      // Fetch the audio file
      const response = await fetch(signedUrl);
      const audioBlob = await response.blob();
      
      // Convert to base64
      const reader = new FileReader();
      reader.readAsDataURL(audioBlob);
      const base64Audio = await new Promise<string>((resolve) => {
        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve(base64);
        };
      });
      
      // Try Deepgram first
      let transcriptData, transcriptError;
      
      try {
        const deepgramResult = await supabase.functions.invoke(
          'transcribe-deepgram',
          {
            body: {
              base64Audio,
              mimeType: 'audio/webm;codecs=opus',
              sessionId: id,
            },
          }
        );
        transcriptData = deepgramResult.data;
        transcriptError = deepgramResult.error;
      } catch (err) {
        console.error('Deepgram error:', err);
        transcriptError = err;
      }

      // Fallback to Whisper if Deepgram fails
      if (transcriptError || !transcriptData?.success) {
        console.log('Deepgram failed, falling back to Whisper...');
        
        try {
          const whisperResult = await supabase.functions.invoke(
            'transcribe-whisper',
            {
              body: {
                base64Audio,
                mimeType: 'audio/webm;codecs=opus',
                sessionId: id,
              },
            }
          );
          transcriptData = whisperResult.data;
          transcriptError = whisperResult.error;
        } catch (err) {
          console.error('Whisper error:', err);
          transcriptError = err;
        }
      }

      if (transcriptError || !transcriptData?.success) {
        throw new Error('Both Deepgram and Whisper transcription failed');
      }

      const newTranscript = transcriptData.text;
      
      // Run analysis
      await supabase.functions.invoke('analyze-insights', {
        body: { sessionId: id, transcript: newTranscript },
      });

      // Extract tasks
      await supabase.functions.invoke('extract-tasks', {
        body: { session_id: id, overwrite: true },
      });

      // Mark session as ready
      await supabase
        .from('sessions')
        .update({ status: 'ready' })
        .eq('id', id);

      await loadData();
      toast.success('Transcription completed successfully!', { duration: 2000 });
    } catch (error) {
      console.error('Error retrying transcription:', error);
      toast.error('Transcription failed again. Please try later.', { duration: 2000 });
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
        toast.success('Task added', { duration: 1000 });
      }
    } catch (error) {
      console.error('Error adding task:', error);
      toast.error('Failed to add task', { duration: 1000 });
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
      toast.success('Task updated', { duration: 1000 });
    } catch (error) {
      console.error('Error updating task:', error);
      toast.error('Failed to update task', { duration: 1000 });
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
      toast.success('Task deleted', { duration: 1000 });
    } catch (error) {
      console.error('Error deleting task:', error);
      toast.error('Failed to delete task', { duration: 1000 });
    }
  };

  const handleRegenerateTasks = async () => {
    if (!id) return;

    try {
      setIsRefreshing(true);
      toast.info('Submitted — generating tasks…', { duration: 1000 });
      
      await supabase.functions.invoke('extract-tasks', {
        body: { session_id: id, overwrite: true },
      });

      await loadData();
      toast.success('Tasks generated', { duration: 1000 });
    } catch (error) {
      console.error('Error regenerating tasks:', error);
      toast.error('Failed to generate tasks', { duration: 1000 });
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleExportPDF = async () => {
    try {
      const pdf = new jsPDF();
      const pageWidth = pdf.internal.pageSize.getWidth();
      const margin = 20;
      let yPos = 20;

      // Add logo
      pdf.setFontSize(20);
      pdf.setFont('helvetica', 'bold');
      pdf.text('Firefly', pageWidth / 2, yPos, { align: 'center' });
      yPos += 15;

      // Add title
      pdf.setFontSize(16);
      pdf.text(session?.title || 'Recording', margin, yPos);
      yPos += 10;

      // Add overview
      if (summary?.overview) {
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Overview', margin, yPos);
        yPos += 7;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        const overviewLines = pdf.splitTextToSize(summary.overview, pageWidth - 2 * margin);
        pdf.text(overviewLines, margin, yPos);
        yPos += overviewLines.length * 5 + 5;
      }

      // Add key topics
      if (summary?.key_topics && summary.key_topics.length > 0) {
        if (yPos > 250) {
          pdf.addPage();
          yPos = 20;
        }
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Key Topics', margin, yPos);
        yPos += 7;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        summary.key_topics.forEach((topic: string) => {
          const topicLines = pdf.splitTextToSize(`• ${topic}`, pageWidth - 2 * margin);
          pdf.text(topicLines, margin, yPos);
          yPos += topicLines.length * 5;
        });
        yPos += 5;
      }

      // Add action items
      const openTasks = tasks.filter(t => t.status === 'open');
      if (openTasks.length > 0) {
        if (yPos > 250) {
          pdf.addPage();
          yPos = 20;
        }
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Action Items', margin, yPos);
        yPos += 7;
        pdf.setFontSize(10);
        pdf.setFont('helvetica', 'normal');
        openTasks.forEach((task) => {
          const taskText = `• ${task.title}${task.owner ? ` (@${task.owner})` : ''}`;
          const taskLines = pdf.splitTextToSize(taskText, pageWidth - 2 * margin);
          pdf.text(taskLines, margin, yPos);
          yPos += taskLines.length * 5;
        });
        yPos += 5;
      }

      // Add transcript
      if (transcript) {
        if (yPos > 200) {
          pdf.addPage();
          yPos = 20;
        }
        pdf.setFontSize(14);
        pdf.setFont('helvetica', 'bold');
        pdf.text('Transcript', margin, yPos);
        yPos += 7;
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        const transcriptLines = pdf.splitTextToSize(transcript, pageWidth - 2 * margin);
        transcriptLines.forEach((line: string) => {
          if (yPos > 280) {
            pdf.addPage();
            yPos = 20;
          }
          pdf.text(line, margin, yPos);
          yPos += 4;
        });
      }

      pdf.save(`${session?.title || 'recording'}.pdf`);
      toast.success('PDF exported', { duration: 1000 });
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export PDF', { duration: 1000 });
    }
  };

  if (isLoading) {
    return (
      <div 
        className="min-h-screen bg-black flex flex-col items-center justify-center p-6 transition-colors duration-500"
        style={{ minHeight: '100svh' }}
      >
        <img src={fflogo} alt="Firefly" className="h-20 mb-12 brightness-0 invert" />
        <div className="w-full max-w-2xl px-4">
          <ProgressBar value={loadingProgress} label={loadingLabel} />
        </div>
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
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw size={20} className={isRefreshing ? 'animate-spin' : ''} />
          </Button>
        </div>
      </header>

      <div className="p-4 space-y-4">
        {session?.status === 'transcription_failed' && (
          <Card className="border-destructive">
            <CardContent className="pt-6">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="text-destructive font-semibold">⚠️ Transcription Failed</div>
                </div>
                <p className="text-sm text-muted-foreground">
                  The audio was saved, but transcription failed. You can listen to the recording below and retry transcription.
                </p>
                {session.audio_url && audioSignedUrl && (
                  <div className="space-y-2">
                    <audio controls className="w-full">
                      <source src={audioSignedUrl} type="audio/webm" />
                      Your browser does not support the audio element.
                    </audio>
                    <Button
                      onClick={handleRetryTranscription}
                      disabled={isRefreshing}
                      className="w-full"
                    >
                      <RefreshCw size={16} className={isRefreshing ? 'animate-spin mr-2' : 'mr-2'} />
                      Retry Transcription
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="insights" className="w-full">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="insights">Insights</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="transcript">Transcript</TabsTrigger>
          </TabsList>

          <TabsContent value="insights" className="space-y-4 mt-4">
            {!summary ? (
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                </CardContent>
              </Card>
            ) : summary?.overview ? (
              <Card>
                <CardHeader>
                  <CardTitle>Overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{summary.overview}</p>
                </CardContent>
              </Card>
            ) : null}

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
              <Button 
                onClick={handleRegenerateTasks} 
                disabled={isRefreshing}
                className="ml-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl"
              >
                <Send className="h-4 w-4" /> Submit
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
                {!transcript ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                ) : (
                  <div className="space-y-4">
                    {formatTranscript(transcript).map((block, i) => (
                      <div key={i} className="mb-4">
                        {block.heading && <p className="font-semibold text-[15px] mb-1">{block.heading}</p>}
                        {block.body && <p className="text-[15px] leading-6 text-muted-foreground whitespace-pre-wrap">{block.body}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <div className="flex gap-2 pt-4 pb-8">
          <Button onClick={() => setShareModalOpen(true)} variant="outline" className="flex-1">
            <Share2 size={16} className="mr-2" />
            Share
          </Button>
          <Button onClick={handleExportPDF} variant="outline" className="flex-1">
            <Download size={16} className="mr-2" />
            Export PDF
          </Button>
        </div>
      </div>

      <footer className="w-full flex justify-center py-6 opacity-80">
        <img src={fflogo} alt="Firefly" className="h-12" />
      </footer>

      <PinShareDialog
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        sessionId={id!}
      />
    </div>
  );
};

export default Summary;
