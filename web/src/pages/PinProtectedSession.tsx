import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PinInput } from '@/components/PinInput';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ArrowLeft, Calendar, Clock, CheckCircle2, Circle, AlertCircle } from 'lucide-react';

export default function PinProtectedSession() {
  const { id: sessionId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionData, setSessionData] = useState<any>(null);
  const [token, setToken] = useState<string | null>(null);

  const verifyPin = async (pin: string) => {
    setIsVerifying(true);
    setError(null);

    try {
      const { data, error } = await supabase.functions.invoke('verify-share-pin', {
        body: { session_id: sessionId, pin },
      });

      if (error) throw error;

      if (data.error) {
        setError(data.error);
        return;
      }

      // Store token in memory (not localStorage for security)
      setToken(data.token);
      setSessionData(data);
      toast.success('Access granted', { duration: 1000 });
    } catch (err: any) {
      console.error('PIN verification error:', err);
      setError(err.message || 'Failed to verify PIN');
    } finally {
      setIsVerifying(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground">Invalid session link</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show PIN input if not authenticated
  if (!token || !sessionData) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Shared Recording</CardTitle>
            <CardDescription>
              This recording is protected. Enter the PIN to access it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PinInput 
              onSubmit={verifyPin}
              isLoading={isVerifying}
              error={error}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show session data once authenticated
  const { session, summary, tasks, transcript } = sessionData;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        <Button
          variant="ghost"
          onClick={() => navigate('/')}
          className="mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>

        {/* Session Header */}
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <CardTitle className="text-2xl">{session.title || 'Untitled Recording'}</CardTitle>
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-4 w-4" />
                    {formatDate(session.started_at)}
                  </span>
                  {session.duration_seconds && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-4 w-4" />
                      {formatDuration(session.duration_seconds)}
                    </span>
                  )}
                </div>
              </div>
              <Badge variant={session.status === 'completed' ? 'default' : 'secondary'}>
                {session.status}
              </Badge>
            </div>
          </CardHeader>
        </Card>

        {/* Overview */}
        {summary?.overview && (
          <Card>
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground leading-relaxed">{summary.overview}</p>
            </CardContent>
          </Card>
        )}

        {/* Action Items */}
        {tasks && tasks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Action Items</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {tasks.map((task: any) => (
                  <div key={task.id} className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
                    ) : task.status === 'in_progress' ? (
                      <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium">{task.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {task.owner && (
                          <span className="text-xs text-muted-foreground">
                            Owner: {task.owner}
                          </span>
                        )}
                        {task.priority !== 'normal' && (
                          <Badge variant="outline" className="text-xs">
                            {task.priority}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Key Topics */}
        {summary?.key_topics && summary.key_topics.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Key Topics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {summary.key_topics.map((topic: string, index: number) => (
                  <Badge key={index} variant="secondary">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Full Transcript */}
        {transcript && (
          <Card>
            <CardHeader>
              <CardTitle>Transcript</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm max-w-none">
                <p className="text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {transcript}
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
};
