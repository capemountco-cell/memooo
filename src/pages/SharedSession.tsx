import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import fflogo from '@/assets/fflogo.svg';

export default function SharedSession() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [sessionData, setSessionData] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const verifyPin = async () => {
    if (!slug || !pin) return;

    setIsVerifying(true);
    try {
      // Get shared session
      const { data: sharedSession, error: sharedError } = await supabase
        .from('shared_sessions')
        .select('*')
        .eq('slug', slug)
        .eq('pin', pin)
        .single();

      if (sharedError || !sharedSession) {
        toast.error('Invalid PIN', { duration: 1000 });
        setIsVerifying(false);
        return;
      }

      // Update view count
      await supabase
        .from('shared_sessions')
        .update({ view_count: sharedSession.view_count + 1 })
        .eq('id', sharedSession.id);

      // Load session data
      const { data: session } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sharedSession.session_id)
        .single();

      const { data: summary } = await supabase
        .from('summaries')
        .select('*')
        .eq('session_id', sharedSession.session_id)
        .maybeSingle();

      const { data: tasks } = await supabase
        .from('tasks')
        .select('*')
        .eq('session_id', sharedSession.session_id)
        .order('created_at', { ascending: true });

      const { data: transcriptData } = await supabase
        .from('transcripts')
        .select('text')
        .eq('session_id', sharedSession.session_id)
        .order('created_at', { ascending: true });

      const transcript = transcriptData?.map(t => t.text).join(' ') || '';

      setSessionData({ session, summary, tasks, transcript });
      setIsAuthenticated(true);
      toast.success('Access granted', { duration: 1000 });
    } catch (error) {
      console.error('Error verifying PIN:', error);
      toast.error('Failed to verify PIN', { duration: 1000 });
    } finally {
      setIsVerifying(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <img src={fflogo} alt="Firefly" className="h-12 mx-auto mb-4 opacity-90" />
            <CardTitle>Enter PIN to Access Recording</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Input
                type="text"
                placeholder="Enter 6-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="text-center text-2xl font-mono tracking-wider"
                maxLength={6}
                onKeyDown={(e) => e.key === 'Enter' && verifyPin()}
              />
              <Button
                onClick={verifyPin}
                disabled={isVerifying || pin.length !== 6}
                className="w-full"
              >
                {isVerifying ? 'Verifying...' : 'Access Recording'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!sessionData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <img src={fflogo} alt="Firefly" className="h-16 mx-auto mb-4 opacity-90" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const { session, summary, tasks, transcript } = sessionData;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3">
        <img src={fflogo} alt="Firefly" className="h-8 opacity-90" />
      </header>

      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">{session?.title || 'Recording'}</h1>

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

        {tasks && tasks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Action Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {tasks.map((task: any) => (
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
                {summary.key_topics.map((topic: string, i: number) => (
                  <li key={i}>• {topic}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {transcript && (
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none text-muted-foreground">
                <div className="whitespace-pre-wrap leading-relaxed">
                  {transcript}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
