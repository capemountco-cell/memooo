import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import evolveLogo from '@/assets/evolve-logo-dark.svg';
import { stripMarkdown, stripMarkdownInline } from '@/utils/markdown';
import { useThemeColor } from '@/hooks/useThemeColor';
import { THEME_COLORS } from '@/lib/themeColors';

export default function SharedSession() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [pin, setPin] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [sessionData, setSessionData] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useThemeColor(THEME_COLORS.surface);

  const verifyPin = async () => {
    if (!slug || !pin) return;

    setIsVerifying(true);
    try {
      // Call the secure function to verify PIN and get session data
      const { data, error } = await supabase
        .rpc('verify_shared_session_pin', {
          p_slug: slug,
          p_pin: pin,
        });

      if (error) throw error;

      // If no data returned, PIN was invalid
      if (!data || data.length === 0) {
        toast.error('Invalid PIN', { duration: 1000 });
        setIsVerifying(false);
        return;
      }

      const result = data[0];

      // Parse the tasks data
      const tasks = result.tasks_data || [];

      setSessionData({
        session: {
          id: result.session_id,
          title: result.session_title,
          status: result.session_status,
          started_at: result.session_started_at,
          duration_seconds: result.session_duration_seconds,
        },
        summary: {
          overview: result.overview,
          key_topics: result.key_topics,
          action_items: result.action_items,
        },
        tasks,
        transcript: result.transcript_text || '',
      });
      
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
            <img src={evolveLogo} alt="Memo" className="w-24 h-auto mx-auto mb-4 opacity-90" />
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
          <img src={evolveLogo} alt="Memo" className="w-24 h-auto mx-auto mb-4 opacity-90" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  const { session, summary, tasks, transcript } = sessionData;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background border-b px-4 py-3">
        <img src={evolveLogo} alt="Memo" className="w-20 h-auto opacity-90" />
      </header>

      <div className="p-4 space-y-4 max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold">{session?.title || 'Recording'}</h1>

        {summary?.overview && (
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{stripMarkdown(summary.overview)}</p>
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
                <div key={task.id} className="text-sm">• {stripMarkdownInline(task.title)}</div>
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
                  <li key={i}>• {stripMarkdownInline(topic)}</li>
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
                  {stripMarkdown(transcript)}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
