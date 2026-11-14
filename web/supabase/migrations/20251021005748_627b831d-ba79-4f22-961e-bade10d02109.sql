-- Create shared_sessions table for sharing functionality
CREATE TABLE IF NOT EXISTS public.shared_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  pin text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  expires_at timestamp with time zone,
  view_count integer NOT NULL DEFAULT 0
);

-- Enable RLS
ALTER TABLE public.shared_sessions ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view shared sessions with valid PIN
CREATE POLICY "Anyone can view shared sessions with valid PIN"
ON public.shared_sessions
FOR SELECT
USING (true);

-- Allow anyone to insert shared sessions
CREATE POLICY "Anyone can create shared sessions"
ON public.shared_sessions
FOR INSERT
WITH CHECK (true);

-- Add index for faster lookups
CREATE INDEX idx_shared_sessions_slug ON public.shared_sessions(slug);
CREATE INDEX idx_shared_sessions_session_id ON public.shared_sessions(session_id);