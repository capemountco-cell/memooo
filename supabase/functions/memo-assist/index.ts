// Live help during a meeting: "Assist", "What should I say?", a typed
// question, or a question about what is on the user's screen.
//
// An OpenAI model reads the recent transcript (and the user's notes, and a screenshot
// when given) and the answer streams back as plain text, so it starts
// appearing in Captain's overlay within a second or two.

import { createClient } from "jsr:@supabase/supabase-js@2";

/** OPENAI_MODEL in the function's secrets overrides the default. */
const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5";

const MAX_PER_HOUR = 120;
/** About twenty minutes of talk; older lines are dropped by the app first. */
const MAX_TRANSCRIPT_CHARS = 40_000;
/** A screenshot of about 5 MB once decoded. */
const MAX_IMAGE_BASE64 = 7_000_000;

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

interface Segment {
  speaker: string;
  startSecs: number;
  text: string;
}

type Mode = "assist" | "say" | "ask" | "screen";

const SYSTEM = `You are Captain, an assistant the user sees privately in a small overlay during a live meeting. Nobody else in the meeting sees you.

You get the most recent part of the transcript ("You" is the user; "Speaker 2", "Speaker 3" and so on are others), the notes the user has typed, and sometimes a screenshot of the user's screen.

Answer for someone who is mid-conversation and glancing at you: lead with the answer, keep it short (two to five sentences, or a few bullets), plain language, no preamble, no headings, no restating the question. Use only what is in the transcript, notes and screenshot plus well-established general knowledge; when you are not sure of a fact, say so briefly rather than guessing.`;

const INSTRUCTION: Record<Mode, string> = {
  assist:
    "Help with what is happening right now: answer the latest question put to the user, explain a term or idea just mentioned, or give the one fact they most likely need. If nothing needs answering, give a one-line summary of where the conversation is and what to watch for.",
  say: "Suggest what the user could say next, in their voice, as one to three sentences they could say out loud. Put the suggestion in quotes. If several directions make sense, give the best one and at most one short alternative.",
  ask: "Answer the user's question.",
  screen:
    "Look at the screenshot of the user's screen together with the conversation, and help with what is on screen: explain it, answer what it asks, or point out what matters for the discussion.",
};

function transcriptText(segments: Segment[]): string {
  return segments
    .map((segment) => {
      const minutes = Math.floor(segment.startSecs / 60);
      const seconds = String(segment.startSecs % 60).padStart(2, "0");
      return `[${minutes}:${seconds}] ${segment.speaker}: ${segment.text}`;
    })
    .join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Use POST." });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return reply(503, { error: "Live help is not set up yet: OPENAI_API_KEY is missing." });
  }

  let input: { mode?: Mode; question?: string; myNotes?: string; transcript?: Segment[]; screenshot?: string };
  try {
    input = await req.json();
  } catch {
    return reply(400, { error: "Send JSON." });
  }
  const mode: Mode = input.mode && input.mode in INSTRUCTION ? input.mode : "assist";
  const question = String(input.question ?? "").slice(0, 2_000).trim();
  if (mode === "ask" && !question) return reply(400, { error: "Type a question first." });
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];
  let conversation = transcriptText(transcript);
  if (conversation.length > MAX_TRANSCRIPT_CHARS) conversation = conversation.slice(-MAX_TRANSCRIPT_CHARS);
  const myNotes = String(input.myNotes ?? "").slice(0, 10_000);
  const screenshot = typeof input.screenshot === "string" ? input.screenshot : "";
  if (screenshot.length > MAX_IMAGE_BASE64) return reply(413, { error: "That screenshot is too large." });
  if (mode === "screen" && !screenshot) return reply(400, { error: "No screenshot came through." });

  const caller =
    "assist:" +
    (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown");
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { count, error: countError } = await db
    .from("memo_token_grants")
    .select("id", { count: "exact", head: true })
    .eq("caller", caller)
    .gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
  if (countError) return reply(500, { error: "Could not check the rate limit." });
  if ((count ?? 0) >= MAX_PER_HOUR) return reply(429, { error: "That's a lot of questions this hour. Try again shortly." });
  await db.from("memo_token_grants").insert({ caller });

  const text = [
    `<transcript>\n${conversation || "(nothing said yet)"}\n</transcript>`,
    `<my_notes>\n${myNotes.trim() || "(none)"}\n</my_notes>`,
    INSTRUCTION[mode],
    question ? `<question>\n${question}\n</question>` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL,
            stream: true,
            // Speed matters more than depth when someone is mid-sentence.
            reasoning_effort: "low",
            max_completion_tokens: 4000,
            messages: [
              { role: "system", content: SYSTEM },
              {
                role: "user",
                content: screenshot
                  ? [
                      { type: "image_url", image_url: { url: `data:image/png;base64,${screenshot}` } },
                      { type: "text", text },
                    ]
                  : text,
              },
            ],
          }),
        });
        if (!response.ok || !response.body) {
          const detail = await response.text();
          console.error("OpenAI error", response.status, detail.slice(0, 500));
          const reason =
            response.status === 401
              ? "Live help is misconfigured: the OpenAI API key was rejected."
              : response.status === 429
                ? "Captain is busy right now (or the OpenAI account is out of credit). Try again in a moment."
                : `Live help failed (${response.status}). Try again.`;
          controller.enqueue(encoder.encode(`(${reason})`));
          return;
        }
        // Server-sent events: one "data: {json}" line per chunk, then "data: [DONE]".
        const reader = response.body.getReader();
        let buffer = "";
        let refused = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const payload = line.trim();
            if (!payload.startsWith("data:")) continue;
            const json = payload.slice(5).trim();
            if (json === "[DONE]") continue;
            try {
              const delta = JSON.parse(json).choices?.[0]?.delta;
              if (delta?.content) controller.enqueue(encoder.encode(delta.content));
              if (delta?.refusal) refused = true;
            } catch {
              // A partial line; the rest arrives in the next chunk.
            }
          }
        }
        if (refused) controller.enqueue(encoder.encode("\n\n(Captain can't help with that one.)"));
      } catch (error) {
        console.error("Assist failed", error);
        controller.enqueue(encoder.encode("\n\n(Live help failed. Try again.)"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { ...cors, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
});
