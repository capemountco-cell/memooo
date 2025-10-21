import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RecordButton } from '@/components/RecordButton';
import { SessionCard } from '@/components/SessionCard';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import fflogo from '@/assets/fflogo.svg';

interface Session {
  id: string;
  title: string;
  started_at: string;
  duration_seconds: number | null;
  status: string;
}

const Index = () => {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [hasActiveRecording, setHasActiveRecording] = useState(false);

  useEffect(() => {
    loadRecentSessions();
    
    // Clean up any stuck recording sessions on mount
    const cleanupStuckSessions = async () => {
      const { data } = await supabase
        .from('sessions')
        .select('id, status')
        .eq('status', 'recording');
      
      if (data && data.length > 0) {
        // Delete or mark as failed
        await supabase
          .from('sessions')
          .delete()
          .eq('status', 'recording');
        
        setHasActiveRecording(false);
      }
    };
    
    cleanupStuckSessions();
  }, []);

  const loadRecentSessions = async () => {
    try {
      const twentyFourHoursAgo = new Date();
      twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

      const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .gte('started_at', twentyFourHoursAgo.toISOString())
        .order('started_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Filter out sessions with 0 or null duration
        const validSessions = data.filter(s => s.duration_seconds && s.duration_seconds > 0);
        
        // Delete sessions with 0 or null duration
        const invalidSessions = data.filter(s => !s.duration_seconds || s.duration_seconds === 0);
        if (invalidSessions.length > 0) {
          const invalidIds = invalidSessions.map(s => s.id);
          await supabase.from('sessions').delete().in('id', invalidIds);
        }
        
        setSessions(validSessions);
        const active = validSessions.some(s => s.status === 'recording');
        setHasActiveRecording(active);
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
    }
  };

  const handleStartRecording = () => {
    navigate('/recorder');
  };

  const handleDeleteSession = async (id: string) => {
    try {
      const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', id);

      if (error) throw error;

      setSessions(sessions.filter(s => s.id !== id));
      toast.success('Recording deleted', { duration: 1000 });
    } catch (error) {
      console.error('Error deleting session:', error);
      toast.error('Failed to delete recording', { duration: 1000 });
    }
  };

  const handleSessionClick = (id: string) => {
    navigate(`/summary/${id}`);
  };

  const bgColor = hasActiveRecording 
    ? 'bg-primary' 
    : 'bg-foreground';

  return (
    <div 
      onClick={handleStartRecording}
      className={`min-h-screen ${bgColor} transition-colors duration-1000 flex flex-col items-center justify-center p-6 cursor-pointer`}
      style={{ minHeight: '100svh' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl">
        <img src={fflogo} alt="Firefly" className="h-20 mb-12 brightness-0 invert" />
        <div onClick={handleStartRecording} className="cursor-pointer">
          <RecordButton isRecording={hasActiveRecording} onClick={handleStartRecording} />
        </div>
      </div>

      {sessions.length > 0 && (
        <div 
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-2xl space-y-4 pb-8"
        >
          <h2 className="text-2xl font-bold text-primary-foreground">Recent</h2>
          <div className="space-y-3">
            {sessions.map(session => (
              <div key={session.id} className="truncate" title={session.title || 'Untitled session'}>
                <SessionCard
                  id={session.id}
                  title={session.title || 'Untitled session'}
                  startedAt={session.started_at}
                  durationSeconds={session.duration_seconds}
                  onDelete={handleDeleteSession}
                  onClick={() => handleSessionClick(session.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Index;
