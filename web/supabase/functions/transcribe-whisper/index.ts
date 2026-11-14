import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    console.log('Whisper transcribe request for session:', sessionId);

    if (!audioPath || !sessionId) {
      throw new Error('Missing required fields: audioPath or sessionId');
    }

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY not configured');
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

    // Create form data
    const formData = new FormData();
    formData.append('file', audioBlob, 'audio.webm');
    formData.append('model', 'whisper-1');

    console.log('Sending to OpenAI Whisper...');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const result = await response.json();
    const transcript = result.text || '';
    
    if (!transcript || transcript.trim().length === 0) {
      console.log('No transcript returned from Whisper, audio may be too short or unclear');
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

    console.log('Transcript saved via Whisper');

    return new Response(
      JSON.stringify({ text: transcript, success: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in transcribe-whisper:', error);
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