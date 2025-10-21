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
    const { base64Audio, mimeType, sessionId } = await req.json();
    console.log('Transcribe request received for session:', sessionId);

    if (!base64Audio || !sessionId) {
      throw new Error('Missing required fields: base64Audio or sessionId');
    }

    const deepgramApiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!deepgramApiKey) {
      throw new Error('DEEPGRAM_API_KEY not configured');
    }

    // Convert base64 to binary
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    console.log('Sending to Deepgram API...');
    
    // Call Deepgram API
    const deepgramResponse = await fetch(
      'https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&diarize=true',
      {
        method: 'POST',
        headers: {
          'Authorization': `Token ${deepgramApiKey}`,
          'Content-Type': mimeType || 'audio/webm',
        },
        body: bytes,
      }
    );

    if (!deepgramResponse.ok) {
      const errorText = await deepgramResponse.text();
      console.error('Deepgram API error:', errorText);
      throw new Error(`Deepgram API error: ${deepgramResponse.status}`);
    }

    const result = await deepgramResponse.json();
    console.log('Deepgram response received');

    const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
    
    if (!transcript || transcript.trim().length === 0) {
      console.log('No transcript returned from Deepgram, audio may be too short or unclear');
      // Return empty transcript instead of throwing error
      return new Response(
        JSON.stringify({ text: '', success: true, warning: 'No speech detected in audio' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify session exists before inserting
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

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