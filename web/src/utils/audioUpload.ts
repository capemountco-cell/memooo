import { supabase } from '@/integrations/supabase/client';

export const uploadAudioFile = async (audioBlob: Blob, sessionId: string): Promise<string> => {
  const fileName = `${sessionId}/${Date.now()}.webm`;
  
  const { data, error } = await supabase.storage
    .from('audio')
    .upload(fileName, audioBlob, {
      contentType: 'audio/webm;codecs=opus',
      upsert: false,
    });

  if (error) {
    console.error('Upload error:', error);
    throw error;
  }

  // Store only the path, not a public URL
  return data.path;
};

export const getAudioSignedUrl = async (path: string): Promise<string> => {
  const { data, error } = await supabase.storage
    .from('audio')
    .createSignedUrl(path, 3600); // 1 hour expiration

  if (error) {
    console.error('Error creating signed URL:', error);
    throw error;
  }

  return data.signedUrl;
};

export const convertBlobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};
