import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer } from '@/components/Timer';
import { Waveform } from '@/components/Waveform';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { uploadAudioFile, convertBlobToBase64 } from '@/utils/audioUpload';
import { toast } from 'sonner';

type RecState = 'idle' | 'initializing' | 'recording' | 'paused' | 'error';

const Recorder = () => {
  const navigate = useNavigate();
  const [recState, setRecState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Choose mime with fallback
  const pickMime = () => {
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/mp4',
      'audio/webm',
      'audio/ogg;codecs=opus',
    ];
    return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
  };

  const bgClass = useMemo(() => {
    if (recState === 'recording') return 'bg-primary';
    if (recState === 'paused') return 'bg-[hsl(var(--paused))]';
    return 'bg-foreground';
  }, [recState]);

  // Timer
  useEffect(() => {
    if (recState !== 'recording') return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recState]);

  // Cleanup helper
  const cleanup = () => {
    try {
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    } catch {}
    mediaRecorderRef.current = null;
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  };

  // Start recording on mount
  useEffect(() => {
    const initRecording = async () => {
      if (recState !== 'idle') return;
      setRecState('initializing');
      setSeconds(0);

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

        // Get media stream
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 24000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        streamRef.current = stream;

        // Set up audio context for waveform
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
        analyserRef.current = audioContextRef.current.createAnalyser();
        const source = audioContextRef.current.createMediaStreamSource(stream);
        source.connect(analyserRef.current);
        analyserRef.current.fftSize = 2048;

        // Set up media recorder
        const mimeType = pickMime();
        const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        mediaRecorderRef.current = mr;

        chunksRef.current = [];
        mr.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };
        
        mr.onstart = () => setRecState('recording');
        mr.onpause = () => setRecState('paused');
        mr.onresume = () => setRecState('recording');
        mr.onerror = (e) => {
          console.error('MediaRecorder error', e);
          toast.error('Recording error.', { duration: 1000 });
          cleanup();
          setRecState('error');
        };

        mr.start(250);
      } catch (err) {
        console.error('Failed to start recording', err);
        toast.error('Failed to start recording. Check mic permissions.', { duration: 1000 });
        cleanup();
        setRecState('error');
        // Return to home after brief delay
        setTimeout(() => navigate('/'), 1200);
      }
    };

    initRecording();
  }, []);

  const pauseOrResume = () => {
    const mr = mediaRecorderRef.current;
    if (!mr) return;
    if (mr.state === 'recording') mr.pause();
    else if (mr.state === 'paused') mr.resume();
  };

  const handleScreenTap = () => {
    if (isProcessing) return;
    
    // Start recording if idle
    if (recState === 'idle') {
      // Will be handled by the useEffect on mount
      return;
    }
    
    // Toggle pause/resume when recording or paused
    if (recState === 'recording' || recState === 'paused') pauseOrResume();
  };

  const handleCancel = () => {
    mediaRecorderRef.current?.stop();
    cleanup();
    if (sessionId) {
      supabase.from('sessions').delete().eq('id', sessionId);
    }
    navigate('/');
  };

  const handleDone = async () => {
    if (!sessionId || isProcessing) return;

    setIsProcessing(true);

    const mr = mediaRecorderRef.current;
    if (!mr) {
      toast.error('No recording found.');
      setIsProcessing(false);
      return;
    }

    return new Promise<void>((resolve) => {
      mr.onstop = async () => {
        // Show a short non-persistent toast
        toast.message('Processing recording…');
        
        try {
          const audioBlob = new Blob(chunksRef.current, { 
            type: mr.mimeType || 'audio/webm;codecs=opus' 
          });

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
                mimeType: mr.mimeType || 'audio/webm;codecs=opus',
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

          toast.success('Done!');
          navigate(`/summary/${sessionId}`);
        } catch (error) {
          console.error('Error processing recording:', error);
          toast.error('Upload failed');
          setIsProcessing(false);
        } finally {
          cleanup();
          resolve();
        }
      };

      mr.stop();
      setRecState('idle');
    });
  };

  return (
    <div
      onClick={handleScreenTap}
      className={`min-h-screen ${bgClass} transition-colors duration-500 flex flex-col items-center justify-center p-6 text-primary-foreground relative`}
      style={{ minHeight: '100svh' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-12 max-w-4xl w-full">
        <Timer seconds={seconds} />
        <Waveform analyser={analyserRef.current} />
        
        <div className="text-center space-y-1">
          {recState === 'recording' && (
            <>
              <p className="text-base opacity-90">Recording from Microphone</p>
              <p className="text-sm opacity-75">Tap anywhere to pause</p>
            </>
          )}
          {recState === 'paused' && (
            <>
              <p className="text-base opacity-90">Recording Paused</p>
              <p className="text-sm opacity-75">Tap anywhere to resume</p>
            </>
          )}
          {recState === 'idle' && (
            <p className="text-sm opacity-75">Tap anywhere to start</p>
          )}
        </div>
      </div>

      <div className="w-full max-w-md px-4 pb-8 pt-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleDone();
            }}
            disabled={isProcessing || seconds < 1}
            className="h-12 rounded-2xl text-base font-medium bg-primary-foreground text-foreground hover:bg-primary-foreground/90"
          >
            Done
          </Button>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleCancel();
            }}
            disabled={isProcessing}
            className="h-12 rounded-2xl text-base bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 hover:bg-primary-foreground/15"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Recorder;
