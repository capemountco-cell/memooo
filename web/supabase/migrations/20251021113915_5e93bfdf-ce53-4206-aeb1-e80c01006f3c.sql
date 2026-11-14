-- Make audio bucket private
UPDATE storage.buckets 
SET public = false 
WHERE id = 'audio';

-- Drop all existing public access policies
DROP POLICY IF EXISTS "Audio files are publicly accessible" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update their audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete audio" ON storage.objects;

-- Create owner-based RLS policies for audio bucket
-- Users can only upload audio for sessions they own
CREATE POLICY "Users can upload audio for their sessions"
ON storage.objects
FOR INSERT
TO authenticated, anon
WITH CHECK (
  bucket_id = 'audio' 
  AND (storage.foldername(name))[1] IN (
    SELECT id::text 
    FROM sessions 
    WHERE owner_user_id = auth.uid()
  )
);

-- Users can only view audio from their sessions
CREATE POLICY "Users can view their session audio"
ON storage.objects
FOR SELECT
TO authenticated, anon
USING (
  bucket_id = 'audio'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text 
    FROM sessions 
    WHERE owner_user_id = auth.uid()
  )
);

-- Users can only delete audio from their sessions
CREATE POLICY "Users can delete their session audio"
ON storage.objects
FOR DELETE
TO authenticated, anon
USING (
  bucket_id = 'audio'
  AND (storage.foldername(name))[1] IN (
    SELECT id::text 
    FROM sessions 
    WHERE owner_user_id = auth.uid()
  )
);