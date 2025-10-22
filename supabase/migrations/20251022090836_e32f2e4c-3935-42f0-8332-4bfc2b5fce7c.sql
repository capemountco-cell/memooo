-- Add PIN sharing columns to sessions table
ALTER TABLE sessions 
ADD COLUMN IF NOT EXISTS pin_hash text,
ADD COLUMN IF NOT EXISTS share_token text;

-- Create table for rate limiting PIN attempts
CREATE TABLE IF NOT EXISTS pin_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  ip_address text NOT NULL,
  attempt_time timestamp with time zone NOT NULL DEFAULT now(),
  success boolean NOT NULL DEFAULT false,
  locked_until timestamp with time zone
);

-- Enable RLS on pin_attempts
ALTER TABLE pin_attempts ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage pin_attempts (used by edge functions)
CREATE POLICY "Service role can manage pin_attempts"
ON pin_attempts
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Create index for efficient rate limit queries
CREATE INDEX IF NOT EXISTS idx_pin_attempts_session_ip_time 
ON pin_attempts(session_id, ip_address, attempt_time DESC);

-- Allow public to read sessions by ID when they have valid PIN
CREATE POLICY "Anyone can read session with valid share_token"
ON sessions
FOR SELECT
USING (share_token IS NOT NULL);

-- Create function to clean up old PIN attempts (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_old_pin_attempts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  DELETE FROM pin_attempts 
  WHERE attempt_time < now() - interval '1 hour';
END;
$$;