import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer } from '@/components/Timer';
import { Waveform } from '@/components/Waveform';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { useAudioRecorder } from '@/hooks/useAudioRecorder';
import { supabase } from '@/integrations/supabase/client';
import { uploadAudioFile, convertBlobToBase64 } from '@/utils/audioUpload';
import { toast } from 'sonner';

const Recorder = () => {
  const navigate = useNavigate();
  const {
    isRecording,
    isPaused,
    seconds,
    analyser,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    cancelRecording,
  } = useAudioRecorder();

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    // Start recording immediately on mount
    const initRecording = async () => {
      try {
        // Create session
        const { data: session, error } = await supabase
          .from('sessions')
          .insert({
            title: `Recording ${new Date().toLocaleDateString()}`,
            status: 'recording',
          })
          .select()
          .single();

        if (error) throw error;
        setSessionId(session.id);

        // Start audio recording
        await startRecording();
      } catch (error) {
        console.error('Failed to start recording:', error);
        toast.error('Failed to start recording');
        navigate('/');
      }
    };

    initRecording();
  }, []);

  const handleScreenTap = () => {
    if (isProcessing) return;
    
    if (isPaused) {
      resumeRecording();
    } else if (isRecording) {
      pauseRecording();
    }
  };

  const handleDone = async () => {
    if (!sessionId || isProcessing) return;

    setIsProcessing(true);
    toast.loading('Processing recording...');

    try {
      // Stop recording
      const audioBlob = await stopRecording();

      // Update session
      await supabase
        .from('sessions')
        .update({
          ended_at: new Date().toISOString(),
          duration_seconds: seconds,
          status: 'processing',
        })
        .eq('id', sessionId);

      // Upload audio
      const audioUrl = await uploadAudioFile(audioBlob, sessionId);
      await supabase
        .from('sessions')
        .update({ audio_url: audioUrl })
        .eq('id', sessionId);

      // Transcribe with Deepgram
      const base64Audio = await convertBlobToBase64(audioBlob);
      const { data: transcriptData, error: transcriptError } = await supabase.functions.invoke(
        'transcribe-deepgram',
        {
          body: {
            base64Audio,
            mimeType: 'audio/webm;codecs=opus',
            sessionId,
          },
        }
      );

      if (transcriptError || !transcriptData?.success) {
        throw new Error('Transcription failed');
      }

      const transcript = transcriptData.text;

      // Analyze insights
      await supabase.functions.invoke('analyze-insights', {
        body: { sessionId, transcript },
      });

      // Extract tasks
      await supabase.functions.invoke('extract-tasks', {
        body: { session_id: sessionId, overwrite: true },
      });

      // Mark as ready
      await supabase
        .from('sessions')
        .update({ status: 'ready' })
        .eq('id', sessionId);

      toast.success('Recording processed!');
      navigate(`/summary/${sessionId}`);
    } catch (error) {
      console.error('Error processing recording:', error);
      toast.error('Failed to process recording');
      setIsProcessing(false);
    }
  };

  const handleCancel = () => {
    cancelRecording();
    if (sessionId) {
      supabase.from('sessions').delete().eq('id', sessionId);
    }
    navigate('/');
  };

  const bgColor = isPaused
    ? 'bg-[hsl(var(--paused))]'
    : 'bg-primary';

  return (
    <div
      onClick={handleScreenTap}
      className={`min-h-screen ${bgColor} transition-colors duration-500 flex flex-col items-center justify-center p-6 text-primary-foreground relative`}
      style={{ minHeight: '100svh' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-12 max-w-4xl w-full">
        <Timer seconds={seconds} />
        <Waveform analyser={analyser} />
        <p className="text-lg opacity-80">
          {isPaused ? 'Recording Paused' : 'Recording from Microphone'}
        </p>
        {!isPaused && (
          <p className="text-sm opacity-60">Tap anywhere to pause</p>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 pb-8 pt-4 w-full">
        <Button
          onClick={handleDone}
          disabled={isProcessing || seconds < 1}
          className="min-w-[160px] h-14 rounded-full text-lg bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 hover:bg-primary-foreground/15"
        >
          Done
        </Button>
        <Button
          onClick={handleCancel}
          disabled={isProcessing}
          variant="ghost"
          size="icon"
          className="h-14 w-14 rounded-full bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 hover:bg-primary-foreground/15"
        >
          <X size={24} />
        </Button>
      </div>
    </div>
  );
};

export default Recorder;
