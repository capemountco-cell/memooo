-- 1) Add owner to sessions (single source of truth)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS owner_user_id uuid;

-- 2) Set default for new inserts
ALTER TABLE sessions ALTER COLUMN owner_user_id SET DEFAULT auth.uid();

-- 3) Tighten RLS: only the owner can read/write their rows
DROP POLICY IF EXISTS "Enable all operations for sessions" ON sessions;
CREATE POLICY "Owner can all on sessions"
ON sessions
FOR ALL
USING (auth.uid() = owner_user_id)
WITH CHECK (auth.uid() = owner_user_id);

-- 4) Child tables inherit privacy via join to sessions
DROP POLICY IF EXISTS "Enable all operations for transcripts" ON transcripts;
CREATE POLICY "Owner can all on transcripts"
ON transcripts
FOR ALL
USING (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = transcripts.session_id AND s.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = transcripts.session_id AND s.owner_user_id = auth.uid()
));

DROP POLICY IF EXISTS "Enable all operations for summaries" ON summaries;
CREATE POLICY "Owner can all on summaries"
ON summaries
FOR ALL
USING (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = summaries.session_id AND s.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = summaries.session_id AND s.owner_user_id = auth.uid()
));

DROP POLICY IF EXISTS "Enable all operations for tasks" ON tasks;
CREATE POLICY "Owner can all on tasks"
ON tasks
FOR ALL
USING (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = tasks.session_id AND s.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = tasks.session_id AND s.owner_user_id = auth.uid()
));

DROP POLICY IF EXISTS "Enable all operations for participants" ON participants;
CREATE POLICY "Owner can all on participants"
ON participants
FOR ALL
USING (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = participants.session_id AND s.owner_user_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM sessions s
  WHERE s.id = participants.session_id AND s.owner_user_id = auth.uid()
));

-- Helpful indexes
CREATE INDEX IF NOT EXISTS sessions_owner_idx ON sessions(owner_user_id);