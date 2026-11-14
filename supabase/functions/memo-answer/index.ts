// Answers a question asked in a meeting, only from sources, with citations.
//
// The app detects a question in the live transcript, searches the user's past
// notes on the Mac, and sends the question with the matching passages and the
// recent transcript. The model answers only when those sources clearly do,
// marking each claim with the source it came from ([1], [2]); otherwise it
// says nothing was found, so the overlay shows "Nothing certain found" rather
// than a confident guess. The key is OPENAI_API_KEY in the function secrets;
// OPENAI_MODEL may name a different model than the default.

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5";
const MAX_PER_HOUR = 200;
const MAX_TRANSCRIPT_CHARS = 30_000;
const MAX_SOURCES = 8;
const MAX_SOURCE_CHARS = 1_000;

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

interface Source {
  title: string;
  date: string;
  text: string;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "answer", "cited", "fromThisMeeting"],
  properties: {
    found: { type: "boolean" },
    answer: { type: "string" },
    cited: { type: "array", items: { type: "integer" } },
    fromThisMeeting: { type: "boolean" },
  },
};

const SYSTEM = `You answer questions that come up during a live meeting, for the user of Captain, a meeting-notes app. The answer appears on the user's screen while the meeting goes on.

You get the question, the recent transcript of this meeting, and numbered passages from the user's past meeting notes. Answer ONLY from those. Do not use general knowledge, do not guess, do not fill gaps.

If the passages or the transcript clearly answer the question: found = true. Write the answer in one to three short, plain sentences, leading with the answer itself. After each sentence that relies on a numbered passage, put its number in square brackets, like [1] or [1][2]. List every number you used in "cited". Set fromThisMeeting = true if any part of the answer comes from the transcript of this meeting.

If they do not clearly answer it, or only hint at it, or disagree: found = false, answer = "", cited = [], fromThisMeeting = false. Saying nothing is much better than a confident wrong answer.

Write in the language the question was asked in.`;

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
  if (!apiKey) return reply(503, { error: "Answers are not set up yet: OPENAI_API_KEY is missing." });

  let input: { question?: string; transcript?: Segment[]; sources?: Source[] };
  try {
    input = await req.json();
  } catch {
    return reply(400, { error: "Send JSON." });
  }
  const question = String(input.question ?? "").slice(0, 1_000).trim();
  if (!question) return reply(400, { error: "No question." });
  let conversation = transcriptText(Array.isArray(input.transcript) ? input.transcript : []);
  if (conversation.length > MAX_TRANSCRIPT_CHARS) conversation = conversation.slice(-MAX_TRANSCRIPT_CHARS);
  const sources = (Array.isArray(input.sources) ? input.sources : []).slice(0, MAX_SOURCES).map((source) => ({
    title: String(source.title ?? "").slice(0, 120),
    date: String(source.date ?? "").slice(0, 40),
    text: String(source.text ?? "").slice(0, MAX_SOURCE_CHARS),
  }));

  const caller =
    "answer:" +
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

  const numbered = sources.length
    ? sources.map((source, i) => `[${i + 1}] ${source.title} (${source.date})\n${source.text}`).join("\n\n")
    : "(none)";
  const userContent = [
    `<question>\n${question}\n</question>`,
    `<this_meeting_transcript>\n${conversation || "(nothing yet)"}\n</this_meeting_transcript>`,
    `<past_notes>\n${numbered}\n</past_notes>`,
  ].join("\n\n");

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 2000,
        response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userContent },
        ],
      }),
    });
  } catch (error) {
    console.error("Could not reach OpenAI", error);
    return reply(502, { error: "Couldn't reach the answer service." });
  }
  if (!response.ok) {
    const detail = await response.text();
    console.error("OpenAI error", response.status, detail.slice(0, 500));
    if (response.status === 401) return reply(503, { error: "Answers are misconfigured: the OpenAI API key was rejected." });
    if (response.status === 429) return reply(429, { error: "Captain is busy right now. Try again in a moment." });
    return reply(502, { error: `The answer service failed (${response.status}).` });
  }

  try {
    const data = await response.json();
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) return reply(200, { found: false, answer: "", cited: [], fromThisMeeting: false });
    const result = JSON.parse(choice?.message?.content ?? "");
    const cited = (Array.isArray(result.cited) ? result.cited : []).filter(
      (n: unknown) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= sources.length,
    );
    const found = Boolean(result.found) && String(result.answer ?? "").trim() !== "";
    return reply(200, {
      found,
      answer: found ? String(result.answer).trim() : "",
      cited: found ? [...new Set(cited)] : [],
      fromThisMeeting: found && Boolean(result.fromThisMeeting),
    });
  } catch (error) {
    console.error("Answer was not valid JSON", error);
    return reply(502, { error: "The answer came back garbled." });
  }
});
