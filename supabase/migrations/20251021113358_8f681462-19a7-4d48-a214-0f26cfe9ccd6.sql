-- Drop existing permissive policies on shared_sessions
DROP POLICY IF EXISTS "Anyone can create shared sessions" ON shared_sessions;
DROP POLICY IF EXISTS "Anyone can view shared sessions with valid PIN" ON shared_sessions;

-- Add owner_user_id column to track who created the share link
ALTER TABLE shared_sessions ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid();

-- Create index for performance
CREATE INDEX IF NOT EXISTS shared_sessions_owner_idx ON shared_sessions(owner_user_id);

-- New RLS policies: Only owners can manage their shared sessions
CREATE POLICY "Owners can insert their shared sessions"
ON shared_sessions
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = owner_user_id);

CREATE POLICY "Owners can select their shared sessions"
ON shared_sessions
FOR SELECT
TO authenticated
USING (auth.uid() = owner_user_id);

CREATE POLICY "Owners can update their shared sessions"
ON shared_sessions
FOR UPDATE
TO authenticated
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

-- Create a secure function to verify PIN and return session data
-- This function runs with SECURITY DEFINER to bypass RLS, but only returns data if PIN matches
CREATE OR REPLACE FUNCTION public.verify_shared_session_pin(
  p_slug text,
  p_pin text
)
RETURNS TABLE (
  shared_session_id uuid,
  session_id uuid,
  session_title text,
  session_status text,
  session_started_at timestamptz,
  session_duration_seconds integer,
  overview text,
  key_topics text[],
  action_items jsonb,
  tasks_data jsonb,
  transcript_text text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shared_session shared_sessions;
  v_session sessions;
  v_summary summaries;
BEGIN
  -- Find the shared session by slug and PIN
  SELECT * INTO v_shared_session
  FROM shared_sessions
  WHERE slug = p_slug AND pin = p_pin;
  
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
$$;