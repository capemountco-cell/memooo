import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.1/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Verify PIN using PBKDF2 with Web Crypto API
async function verifyPin(pin: string, hash: string): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(hash), c => c.charCodeAt(0));
    const salt = combined.slice(0, 16);
    const storedHash = combined.slice(16);
    
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      256
    );
    const computedHash = new Uint8Array(derivedBits);
    
    // Constant-time comparison
    if (storedHash.length !== computedHash.length) return false;
    let result = 0;
    for (let i = 0; i < storedHash.length; i++) {
      result |= storedHash[i] ^ computedHash[i];
    }
    return result === 0;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { session_id, pin } = await req.json();

    // Validate input
    if (!session_id || !pin) {
      throw new Error('session_id and pin are required');
    }

    // Normalize PIN (trim, NFKC)
    const normalizedPin = pin.normalize('NFKC').trim();

    // Validate PIN format (exactly 6 digits)
    if (!/^[0-9]{6}$/.test(normalizedPin)) {
      throw new Error('Invalid PIN format');
    }

    // Get client IP for rate limiting
    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 
                     req.headers.get('x-real-ip') || 
                     'unknown';

    // Check rate limiting
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    
    // Check if currently locked
    const { data: lockCheck } = await supabase
      .from('pin_attempts')
      .select('locked_until')
      .eq('session_id', session_id)
      .eq('ip_address', clientIp)
      .not('locked_until', 'is', null)
      .gte('locked_until', new Date().toISOString())
      .limit(1)
      .single();

    if (lockCheck) {
      console.log(`Rate limited: session ${session_id}, IP ${clientIp}`);
      await supabase.from('pin_attempts').insert({
        session_id,
        ip_address: clientIp,
        success: false,
      });
      
      return new Response(
        JSON.stringify({ error: 'Too many failed attempts. Please try again later.' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 429 
        }
      );
    }

    // Count recent failed attempts
    const { data: recentAttempts } = await supabase
      .from('pin_attempts')
      .select('id')
      .eq('session_id', session_id)
      .eq('ip_address', clientIp)
      .eq('success', false)
      .gte('attempt_time', tenMinutesAgo);

    const failedCount = recentAttempts?.length || 0;

    if (failedCount >= 5) {
      // Lock for 15 minutes
      const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      
      await supabase.from('pin_attempts').insert({
        session_id,
        ip_address: clientIp,
        success: false,
        locked_until: lockedUntil,
      });

      console.log(`Rate limit triggered: session ${session_id}, IP ${clientIp}`);
      
      return new Response(
        JSON.stringify({ error: 'Too many failed attempts. Locked for 15 minutes.' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 429 
        }
      );
    }

    // Get session with pin_hash
    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('id, pin_hash, share_token, title, status, started_at, duration_seconds, audio_url')
      .eq('id', session_id)
      .single();

    if (sessionError || !session || !session.pin_hash) {
      await supabase.from('pin_attempts').insert({
        session_id,
        ip_address: clientIp,
        success: false,
      });
      
      throw new Error('Session not found or sharing not enabled');
    }

    // Verify PIN with PBKDF2 (constant-time comparison)
    const isValid = await verifyPin(normalizedPin, session.pin_hash);

    if (!isValid) {
      // Log failed attempt
      await supabase.from('pin_attempts').insert({
        session_id,
        ip_address: clientIp,
        success: false,
      });

      console.log(`Failed PIN attempt for session ${session_id} from IP ${clientIp}`);
      
      return new Response(
        JSON.stringify({ error: 'Invalid PIN' }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401 
        }
      );
    }

    // Log successful attempt
    await supabase.from('pin_attempts').insert({
      session_id,
      ip_address: clientIp,
      success: true,
    });

    console.log(`Successful PIN verification for session ${session_id} from IP ${clientIp}`);

    // Generate short-lived JWT (60 minutes) scoped to session_id
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const jwt = await create(
      { alg: 'HS256', typ: 'JWT' },
      {
        session_id,
        exp: getNumericDate(60 * 60), // 60 minutes
      },
      key
    );

    // Get summary data
    const { data: summary } = await supabase
      .from('summaries')
      .select('overview, key_topics, action_items')
      .eq('session_id', session_id)
      .single();

    // Get tasks
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id, title, status, priority, owner, due_at')
      .eq('session_id', session_id)
      .order('created_at');

    // Get transcript
    const { data: transcripts } = await supabase
      .from('transcripts')
      .select('text')
      .eq('session_id', session_id)
      .order('created_at');

    const transcriptText = transcripts?.map(t => t.text).join(' ') || '';

    return new Response(
      JSON.stringify({
        token: jwt,
        session: {
          id: session.id,
          title: session.title,
          status: session.status,
          started_at: session.started_at,
          duration_seconds: session.duration_seconds,
          audio_url: session.audio_url,
        },
        summary: summary || null,
        tasks: tasks || [],
        transcript: transcriptText,
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error in verify-share-pin:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
