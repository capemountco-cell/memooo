import { supabase } from "@/integrations/supabase/client";

export async function ensureAnonAuth() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) return session;
    
    // silently create an anonymous user
    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.error("Anon auth failed", error);
      return null;
    }
    return data?.session ?? null;
  } catch (error) {
    console.error("Anon auth error", error);
    return null;
  }
}
