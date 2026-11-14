// Hands the Captain app a short-lived Deepgram token for one streaming session.
//
// The Deepgram API key never leaves this function: it lives in the project's
// Edge Function secrets as DEEPGRAM_API_KEY. The app opens its WebSocket to
// Deepgram with the token this returns, which is only valid for the handshake.
//
// Abuse guard: each caller (by IP) gets at most MAX_PER_HOUR tokens an hour.

import { createClient } from "jsr:@supabase/supabase-js@2";

const TOKEN_TTL_SECONDS = 60;
const MAX_PER_HOUR = 60;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });

  const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
  if (!deepgramKey) {
    return reply(503, { error: "Transcription is not set up yet: DEEPGRAM_API_KEY is missing." });
  }

  const caller =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("cf-connecting-ip") ||
    "unknown";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const { count, error: countError } = await db
    .from("memo_token_grants")
    .select("id", { count: "exact", head: true })
    .eq("caller", caller)
    .gte("created_at", hourAgo);
  if (countError) return reply(500, { error: "Could not check the rate limit." });
  if ((count ?? 0) >= MAX_PER_HOUR) {
    return reply(429, { error: "Too many transcription sessions this hour. Try again shortly." });
  }

  const grant = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${deepgramKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
  });
  if (!grant.ok) {
    const detail = await grant.text();
    console.error("Deepgram grant failed", grant.status, detail);
    return reply(502, { error: `Deepgram refused the token request (${grant.status}).` });
  }
  const { access_token, expires_in } = await grant.json();

  await db.from("memo_token_grants").insert({ caller });
  // Keep the table small: drop grants older than a day, now and then.
  if (Math.random() < 0.05) {
    await db
      .from("memo_token_grants")
      .delete()
      .lt("created_at", new Date(Date.now() - 86_400_000).toISOString());
  }

  return reply(200, { accessToken: access_token, expiresIn: expires_in });
});
