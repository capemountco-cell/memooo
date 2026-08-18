import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { audioPath, sessionId } = await req.json();
    console.log('Transcribe request received for session:', sessionId);

    if (!audioPath || !sessionId) {
      throw new Error('Missing required fields: audioPath or sessionId');
    }

    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY not configured');
    }

    // Initialize Supabase client with service role to access storage
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get signed URL for the audio file (valid for 60 seconds)
    const { data: signedUrlData, error: signedUrlError } = await supabaseAdmin
      .storage
      .from('audio')
      .createSignedUrl(audioPath, 60);

    if (signedUrlError || !signedUrlData) {
      console.error('Error getting signed URL:', signedUrlError);
      throw new Error('Failed to access audio file');
    }

    console.log('Fetching audio from storage...');
    // Fetch audio directly from storage
    const audioResponse = await fetch(signedUrlData.signedUrl);
    if (!audioResponse.ok) {
      throw new Error('Failed to fetch audio from storage');
    }

    const audioBlob = await audioResponse.blob();
    console.log('Sending to Deepgram API...');
    
    // Call Deepgram API with streaming (diarization + utterances for speaker turns)
    const deepgramResponse = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true&utterances=true&punctuate=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramApiKey}`,
          'Content-Type': 'audio/webm',
        },
        body: audioBlob,
      }
    );

    if (!deepgramResponse.ok) {
      const errorText = await deepgramResponse.text();
      console.error('Deepgram API error:', errorText);
      throw new Error(`Deepgram API error: ${deepgramResponse.status}`);
    }

    const result = await deepgramResponse.json();
    console.log('Deepgram response received');

    const alternative = result.results?.channels?.[0]?.alternatives?.[0];
    const flatTranscript: string = alternative?.transcript || '';

    // Group consecutive content by speaker into "Speaker N: ..." blocks
    const speakerLabel = (n: unknown) =>
      typeof n === 'number' && Number.isFinite(n) ? `Speaker ${n + 1}` : null;

    const buildFromUtterances = (): string | null => {
      const utterances = result.results?.utterances ?? result.utterances;
      if (!Array.isArray(utterances) || utterances.length === 0) return null;
      const groups: Array<{ speaker: string | null; parts: string[] }> = [];
      for (const u of utterances) {
        const text = String(u?.transcript ?? '').trim();
        if (!text) continue;
        const label = speakerLabel(u?.speaker);
        const last = groups[groups.length - 1];
        if (last && last.speaker === label) last.parts.push(text);
        else groups.push({ speaker: label, parts: [text] });
      }
      if (groups.length === 0) return null;
      if (groups.every((g) => g.speaker === null)) return null;
      return groups
        .map((g) => (g.speaker ? `${g.speaker}: ${g.parts.join(' ')}` : g.parts.join(' ')))
        .join('\n\n');
    };

    const buildFromWords = (): string | null => {
      const words = alternative?.words;
      if (!Array.isArray(words) || words.length === 0) return null;
      if (!words.some((w: any) => typeof w?.speaker === 'number')) return null;
      const groups: Array<{ speaker: string | null; parts: string[] }> = [];
      for (const w of words) {
        const token = String(w?.punctuated_word ?? w?.word ?? '').trim();
        if (!token) continue;
        const label = speakerLabel(w?.speaker);
        const last = groups[groups.length - 1];
        if (last && last.speaker === label) last.parts.push(token);
        else groups.push({ speaker: label, parts: [token] });
      }
      if (groups.length === 0) return null;
      return groups
        .map((g) => (g.speaker ? `${g.speaker}: ${g.parts.join(' ')}` : g.parts.join(' ')))
        .join('\n\n');
    };

    const transcript = buildFromUtterances() || buildFromWords() || flatTranscript;
    console.log('Diarized transcript built:', transcript ? transcript.slice(0, 80) : '(empty)');

    
    if (!transcript || transcript.trim().length === 0) {
      console.log('No transcript returned from Deepgram, audio may be too short or unclear');
      // Return empty transcript instead of throwing error
      return new Response(
        JSON.stringify({ text: '', success: true, warning: 'No speech detected in audio' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use authenticated supabase client for database operations
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: sessionExists, error: sessionCheckError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .single();

    if (sessionCheckError || !sessionExists) {
      console.error('Session not found:', sessionId);
      throw new Error(`Session ${sessionId} not found in database`);
    }

    // Save to database
    const { error: insertError } = await supabase
      .from('transcripts')
      .insert({
        session_id: sessionId,
        text: transcript,
        timestamp_seconds: 0,
      });

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw insertError;
    }

    console.log('Transcript saved to database');

    return new Response(
      JSON.stringify({ text: transcript, success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcribe-deepgram:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage, success: false }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});