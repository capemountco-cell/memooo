-- Enable pgcrypto for hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Add pin_hash column and drop plain pin column
ALTER TABLE shared_sessions ADD COLUMN pin_hash text;

-- Migrate any existing pins to hashed format (if any exist)
UPDATE shared_sessions 
SET pin_hash = encode(digest(pin, 'sha256'), 'hex')
WHERE pin IS NOT NULL;

-- Make pin_hash required and drop old pin column
ALTER TABLE shared_sessions ALTER COLUMN pin_hash SET NOT NULL;
ALTER TABLE shared_sessions DROP COLUMN pin;

-- Update the verification function to use hashed PINs
CREATE OR REPLACE FUNCTION public.verify_shared_session_pin(p_slug text, p_pin text)
RETURNS TABLE(
  shared_session_id uuid,
  session_id uuid,
  session_title text,
  session_status text,
  session_started_at timestamp with time zone,
  session_duration_seconds integer,
  overview text,
  key_topics text[],
  action_items jsonb,
  tasks_data jsonb,
  transcript_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
DECLARE
  v_shared_session shared_sessions;
  v_session sessions;
  v_summary summaries;
  v_input_hash text;
BEGIN
  -- Hash the input PIN
  v_input_hash := encode(digest(p_pin, 'sha256'), 'hex');
  
  -- Find the shared session by slug and hashed PIN
  SELECT * INTO v_shared_session
  FROM shared_sessions
  WHERE slug = p_slug AND pin_hash = v_input_hash;
  
  -- If not found or PIN doesn't match, return empty
  IF v_shared_session.id IS NULL THEN
    RETURN;
  END IF;
  
  -- Increment view count
  UPDATE shared_sessions
  SET view_count = view_count + 1
  WHERE id = v_shared_session.id;
  
  -- Get session data
  SELECT * INTO v_session
  FROM sessions
  WHERE id = v_shared_session.session_id;
  
  -- Get summary data
  SELECT * INTO v_summary
  FROM summaries
  WHERE session_id = v_shared_session.session_id;
  
  -- Return the session data
  RETURN QUERY
  SELECT
    v_shared_session.id,
    v_session.id,
    v_session.title,
    v_session.status,
    v_session.started_at,
    v_session.duration_seconds,
    v_summary.overview,
    v_summary.key_topics,
    v_summary.action_items,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'title', t.title,
          'status', t.status,
          'priority', t.priority,
          'owner', t.owner,
          'due_at', t.due_at
        )
      )
      FROM tasks t
      WHERE t.session_id = v_shared_session.session_id
      ORDER BY t.created_at
    ) AS tasks_data,
    (
      SELECT string_agg(tr.text, ' ' ORDER BY tr.created_at)
      FROM transcripts tr
      WHERE tr.session_id = v_shared_session.session_id
    ) AS transcript_text;
END;
$function$;