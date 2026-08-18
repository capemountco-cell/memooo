/**
 * Shared speaker-turn parsing + deterministic pastel palette.
 * Used by both the web transcript view and the editorial PDF export
 * so a given speaker keeps the same highlight colour everywhere.
 */

export interface SpeakerTurn {
  speaker: string | null;
  text: string;
}

/** Soft, print-safe pastels (highlighter feel, never neon). */
export const SPEAKER_PALETTE: Array<{ hex: string; rgb: [number, number, number] }> = [
  { hex: '#CFE4F7', rgb: [0xcf, 0xe4, 0xf7] }, // powder blue
  { hex: '#CFEFE2', rgb: [0xcf, 0xef, 0xe2] }, // mint
  { hex: '#FBDFC9', rgb: [0xfb, 0xdf, 0xc9] }, // pale peach
  { hex: '#E1D9F5', rgb: [0xe1, 0xd9, 0xf5] }, // soft lavender
  { hex: '#F7EDBE', rgb: [0xf7, 0xed, 0xbe] }, // butter yellow
  { hex: '#F8D8E2', rgb: [0xf8, 0xd8, 0xe2] }, // pale pink
  { hex: '#DDE8CD', rgb: [0xdd, 0xe8, 0xcd] }, // light sage
  { hex: '#CFEAEC', rgb: [0xcf, 0xea, 0xec] }, // aqua
  { hex: '#EADCCB', rgb: [0xea, 0xdc, 0xcb] }, // warm sand
  { hex: '#DCE0F2', rgb: [0xdc, 0xe0, 0xf2] }, // periwinkle mist
];

const SPEAKER_RE = /^\s*\**\s*([A-Za-z][A-Za-z0-9 .'\-_]{0,38}?)\s*\**\s*:\s*(?!\/\/)([\s\S]*)$/;

const looksLikeSpeaker = (name: string) => {
  const words = name.trim().split(/\s+/);
  if (words.length > 4) return false;
  // Allow "Speaker 1", "Ana", "Dev Patel", "PM"
  return /^[A-Z]/.test(name.trim());
};

/**
 * Parse a transcript into speaker turns.
 * Blocks without a recognisable speaker label keep `speaker: null`
 * so plain transcripts still render as normal prose.
 */
export const parseSpeakerTurns = (raw: string): SpeakerTurn[] => {
  const text = (raw || '').trim();
  if (!text) return [];

  const blocks = text
    .split(/\n{2,}/)
    .flatMap((block) => {
      // Also split single-newline lines that each start with a speaker label
      const lines = block.split('\n');
      const allLabelled = lines.length > 1 && lines.every((l) => SPEAKER_RE.test(l));
      return allLabelled ? lines : [block];
    })
    .map((b) => b.trim())
    .filter(Boolean);

  const turns: SpeakerTurn[] = [];
  blocks.forEach((block) => {
    const m = block.match(SPEAKER_RE);
    if (m && looksLikeSpeaker(m[1])) {
      const speaker = m[1].trim();
      const body = m[2].trim();
      const last = turns[turns.length - 1];
      if (last && last.speaker === speaker) {
        last.text = `${last.text}\n\n${body}`.trim();
      } else {
        turns.push({ speaker, text: body });
      }
    } else {
      turns.push({ speaker: null, text: block });
    }
  });

  return turns;
};

/** Deterministic speaker → palette index, in order of first appearance. */
export const buildSpeakerColorMap = (turns: SpeakerTurn[]) => {
  const map = new Map<string, number>();
  turns.forEach((t) => {
    if (t.speaker && !map.has(t.speaker)) {
      map.set(t.speaker, map.size % SPEAKER_PALETTE.length);
    }
  });
  return map;
};

export const hasSpeakers = (turns: SpeakerTurn[]) => turns.some((t) => t.speaker);
