// Turns a meeting's rough notes and transcript into Captain's write-up.
//
// Claude merges what the user typed with what was said: the user's own points
// are kept (lightly tidied) and flagged, Captain adds what they missed, and
// action items come out with owners and dates. The Anthropic API key stays
// in this function's secrets as ANTHROPIC_API_KEY.

import Anthropic from "npm:@anthropic-ai/sdk@1.8.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const MAX_PER_HOUR = 30;
/** Roughly three hours of conversation. Longer input is refused, never cut. */
const MAX_INPUT_CHARS = 400_000;

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

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "sections", "actionItems"],
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "points"],
        properties: {
          heading: { type: "string" },
          points: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "fromYou"],
              properties: { text: { type: "string" }, fromYou: { type: "boolean" } },
            },
          },
        },
      },
    },
    actionItems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "owner", "due"],
        properties: { task: { type: "string" }, owner: { type: "string" }, due: { type: "string" } },
      },
    },
  },
};

const SYSTEM = `You write meeting notes for Captain, a note-taking app. You get the notes the user typed during a meeting and the transcript, and you return the meeting's write-up.

The user's own notes are the backbone: they show what the user cared about. Keep every point they wrote, tidied into a clear sentence but with their meaning unchanged, and mark it fromYou: true. Then add what the transcript shows they would want and did not write down (decisions, numbers, reasons, open questions, who said what when it matters) as points marked fromYou: false. Put each added point in the section it belongs to, after the user's points on that topic.

Group points into a few sections by topic, each with a short heading. Write points as short, plain sentences, one idea each. No filler, no preamble, no restating the meeting's purpose.

In the transcript, "You" is the user. "Speaker 2", "Speaker 3" and so on are other people; use their names instead where the conversation makes their names clear, otherwise keep the labels.

Action items are things someone agreed to do. Give each one an owner (a name, "You", or "" when unclear) and a due date as said in the meeting ("Wednesday", "by Friday", or "" when none was given).

title: a short name for the meeting, at most six words. If the user's notes already have a title, keep it.

Only use what is in the notes and transcript. Never invent names, numbers, dates or decisions. If the meeting was too short or empty to say much, return few points rather than padding. Write in the language the meeting was held in.`;

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

  if (!Deno.env.get("ANTHROPIC_API_KEY")) {
    return reply(503, { error: "Write-ups are not set up yet: ANTHROPIC_API_KEY is missing." });
  }

  let input: { title?: string; myNotes?: string; transcript?: Segment[] };
  try {
    input = await req.json();
  } catch {
    return reply(400, { error: "Send JSON with title, myNotes and transcript." });
  }
  const title = String(input.title ?? "").slice(0, 200);
  const myNotes = String(input.myNotes ?? "");
  const transcript = Array.isArray(input.transcript) ? input.transcript : [];
  const conversation = transcriptText(transcript);
  if (!myNotes.trim() && !conversation.trim()) {
    return reply(400, { error: "There is nothing to write up yet." });
  }
  if (myNotes.length + conversation.length > MAX_INPUT_CHARS) {
    return reply(413, { error: "This meeting is too long to write up in one go." });
  }

  const caller =
    "writeup:" +
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
  if ((count ?? 0) >= MAX_PER_HOUR) return reply(429, { error: "Too many write-ups this hour. Try again shortly." });
  await db.from("memo_token_grants").insert({ caller });

  const userContent = [
    `<title>${title || "(none)"}</title>`,
    `<my_notes>\n${myNotes.trim() || "(the user wrote nothing)"}\n</my_notes>`,
    `<transcript>\n${conversation || "(no transcript)"}\n</transcript>`,
  ].join("\n\n");

  const client = new Anthropic();
  try {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // If Claude Opus 5.5 declines, the API retries on a suitable model.
      fallbacks: "default",
      system: SYSTEM,
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: SCHEMA },
      },
      messages: [{ role: "user", content: userContent }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === "refusal") {
      return reply(422, { error: "This meeting couldn't be written up." });
    }
    if (message.stop_reason === "max_tokens") {
      return reply(500, { error: "The write-up was too long to finish. Try again." });
    }
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");
    const writeup = JSON.parse(text);
    return reply(200, { writeup });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return reply(429, { error: "Captain is busy right now. Try again in a minute." });
    }
    if (error instanceof Anthropic.AuthenticationError) {
      console.error("Anthropic rejected the API key");
      return reply(503, { error: "Write-ups are misconfigured: the API key was rejected." });
    }
    if (error instanceof Anthropic.APIError) {
      console.error("Anthropic API error", error.status, error.message);
      return reply(502, { error: `The write-up service failed (${error.status}). Try again.` });
    }
    if (error instanceof SyntaxError) {
      console.error("Write-up was not valid JSON");
      return reply(502, { error: "The write-up came back garbled. Try again." });
    }
    console.error("Write-up failed", error);
    return reply(500, { error: "The write-up failed. Try again." });
  }
});
