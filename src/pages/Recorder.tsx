import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timer } from '@/components/Timer';
import { Waveform } from '@/components/Waveform';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { uploadAudioFile, convertBlobToBase64 } from '@/utils/audioUpload';
import { toast } from 'sonner';
import { RecState, bgFor } from '@/lib/recState';
import ProgressBar from '@/components/ProgressBar';

const Recorder = () => {
  const navigate = useNavigate();
  const [recState, setRecState] = useState<RecState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('Preparing…');
  
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
    setRecState('processing'); // Immediate black to prevent red flash
    try {
      mediaRecorderRef.current?.stop();
    } catch {}
    cleanup();
    if (sessionId) {
      supabase.from('sessions').delete().eq('id', sessionId);
    }
    // Brief fade before returning to idle
    setTimeout(() => {
      setRecState('idle');
      navigate('/');
    }, 200);
  };

  const handleDone = async () => {
    if (!sessionId || isProcessing) return;

    setIsProcessing(true);
    const mr = mediaRecorderRef.current;
    if (!mr) {
      toast.info('Nothing to save', { duration: 1000 });
      setIsProcessing(false);
      return;
    }

    // Immediately go to black & progress mode
    setRecState('processing');
    setProgress(5);
    setProgressLabel('Finalizing input…');

    return new Promise<void>((resolve) => {
      mr.onstop = async () => {
        try {
          const audioBlob = new Blob(chunksRef.current, { 
            type: mr.mimeType || 'audio/webm;codecs=opus' 
          });

          // 0–40% Upload with progress
          setProgressLabel('Uploading audio…');
          setProgress(10);
          
          // Update session
          await supabase
            .from('sessions')
            .update({
              ended_at: new Date().toISOString(),
              duration_seconds: seconds,
              status: 'processing',
            })
            .eq('id', sessionId);

          setProgress(20);

          // Upload audio
          const audioUrl = await uploadAudioFile(audioBlob, sessionId);
          await supabase
            .from('sessions')
            .update({ audio_url: audioUrl })
            .eq('id', sessionId);

          setProgress(35);

          // 40–85% Transcribe (Deepgram)
          setProgressLabel('Transcribing (Deepgram)…');
          setProgress(45);
          
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

          setProgress(60);

          if (transcriptError || !transcriptData?.success) {
            throw new Error('Transcription failed');
          }

          const transcript = transcriptData.text;
          setProgress(80);

          // 85–100% Analyze & tasks
          setProgressLabel('Analyzing & extracting tasks…');
          setProgress(85);
          
          await supabase.functions.invoke('analyze-insights', {
            body: { sessionId, transcript },
          });

          setProgress(92);

          await supabase.functions.invoke('extract-tasks', {
            body: { session_id: sessionId, overwrite: true },
          });

          setProgress(98);

          // Mark as ready
          await supabase
            .from('sessions')
            .update({ status: 'ready' })
            .eq('id', sessionId);

          setProgress(100);

          // Navigate to summary
          navigate(`/summary/${sessionId}`);
        } catch (error) {
          console.error('Error processing recording:', error);
          toast.error('Processing failed', { duration: 1000 });
          setRecState('idle');
          setIsProcessing(false);
        } finally {
          cleanup();
          resolve();
        }
      };

      mr.stop();
    });
  };

  return (
    <div
      onClick={handleScreenTap}
      className={`min-h-screen ${bgFor(recState)} transition-colors duration-500 flex flex-col items-center justify-center p-6 text-primary-foreground relative motion-reduce:transition-none`}
      style={{ minHeight: '100svh' }}
    >
      <div className="flex-1 flex flex-col items-center justify-center gap-12 max-w-4xl w-full">
        <Timer seconds={seconds} />
        
        {(recState === 'recording' || recState === 'paused') && (
          <div className="w-full transition-opacity duration-300">
            <Waveform analyser={analyserRef.current} />
          </div>
        )}
        
        {recState === 'processing' && (
          <div className="w-full px-4 transition-opacity duration-300">
            <ProgressBar value={progress} label={progressLabel} />
          </div>
        )}
        
        <div className="text-center space-y-1 leading-tight">
          {recState === 'recording' && (
            <>
              <div className="text-base opacity-90">Recording from microphone</div>
              <div className="text-sm opacity-75">Tap anywhere to pause</div>
            </>
          )}
          {recState === 'paused' && (
            <>
              <div className="text-base opacity-90">Recording paused</div>
              <div className="text-sm opacity-75">Tap anywhere to resume</div>
            </>
          )}
          {recState === 'idle' && (
            <div className="text-sm opacity-75">Tap anywhere to start</div>
          )}
          {recState === 'processing' && (
            <div className="text-base opacity-90">Processing recording…</div>
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
            className="h-12 rounded-2xl text-base font-medium bg-primary-foreground text-foreground hover:bg-primary-foreground/90 transition-opacity duration-300"
          >
            Done
          </Button>
          <Button
            onClick={(e) => {
              e.stopPropagation();
              handleCancel();
            }}
            disabled={isProcessing}
            className="h-12 rounded-2xl text-base bg-primary-foreground/10 backdrop-blur-xl border-2 border-primary-foreground/20 hover:bg-primary-foreground/15 transition-opacity duration-300"
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Recorder;
