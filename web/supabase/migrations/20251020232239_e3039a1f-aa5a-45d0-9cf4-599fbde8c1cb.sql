-- Create update_updated_at_column function for triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Sessions table
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  status text NOT NULL DEFAULT 'recording',
  audio_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Transcripts table
CREATE TABLE transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  text text NOT NULL,
  speaker text,
  timestamp_seconds integer DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Summaries table
CREATE TABLE summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  overview text,
  key_topics text[],
  decisions text[],
  questions text[],
  action_items jsonb DEFAULT '[]',
  risks text[],
  followups text[],
  dates jsonb DEFAULT '[]',
  participants text[],
  detected_templates text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Tasks table
CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  title text NOT NULL,
  owner text,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'open',
  priority text NOT NULL DEFAULT 'normal',
  source text NOT NULL DEFAULT 'ai',
  transcript_ref_seconds numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Participants table
CREATE TABLE participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: All tables public read/write (no auth)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for transcripts" ON transcripts FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for summaries" ON summaries FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all operations for participants" ON participants FOR ALL USING (true) WITH CHECK (true);

-- Indexes
CREATE INDEX sessions_status_idx ON sessions(status);
CREATE INDEX transcripts_session_id_idx ON transcripts(session_id);
CREATE INDEX summaries_session_id_idx ON summaries(session_id);
CREATE INDEX tasks_session_id_idx ON tasks(session_id);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE INDEX participants_session_id_idx ON participants(session_id);

-- Updated_at triggers
CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_summaries_updated_at BEFORE UPDATE ON summaries FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create audio storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('audio', 'audio', true);

-- Storage policies for audio bucket
CREATE POLICY "Audio files are publicly accessible" ON storage.objects FOR SELECT USING (bucket_id = 'audio');
CREATE POLICY "Anyone can upload audio" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'audio');
CREATE POLICY "Anyone can update their audio" ON storage.objects FOR UPDATE USING (bucket_id = 'audio');
CREATE POLICY "Anyone can delete audio" ON storage.objects FOR DELETE USING (bucket_id = 'audio');