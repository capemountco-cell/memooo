import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (userError || !user) {
      throw new Error('Unauthorized');
    }

    const { session_id } = await req.json();

    if (!session_id) {
      throw new Error('session_id is required');
    }

    // Verify user owns the session
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, owner_user_id')
      .eq('id', session_id)
      .single();

    if (sessionError || !session || session.owner_user_id !== user.id) {
      throw new Error('Session not found or unauthorized');
    }

    // Generate 6-digit PIN (zero-padded)
    const pin = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');

    // Hash PIN with bcrypt (strong alternative to argon2id)
    const pinHash = await bcrypt.hash(pin);

    // Generate share token (used for short-lived access)
    const shareToken = crypto.randomUUID();

    // Update session with pin_hash and share_token
    const { error: updateError } = await supabase
      .from('sessions')
      .update({ 
        pin_hash: pinHash,
        share_token: shareToken
      })
      .eq('id', session_id);

    if (updateError) {
      console.error('Error updating session:', updateError);
      throw new Error('Failed to update session');
    }

    console.log(`PIN generated for session ${session_id} by user ${user.id}`);

    // Return plaintext PIN once (never persisted in plaintext)
    return new Response(
      JSON.stringify({ pin, session_id }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in generate-share-pin:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
