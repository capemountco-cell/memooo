/**
 * A muted colour per speaker, from the same family as Captain's off-white
 * palette: clay, sage, slate, plum, ochre, with "You" in neutral stone.
 * Colour never stands alone: the name is always written in the chip.
 */

/** 0 is "You"; 1–5 are the other voices. */
export type Tone = 0 | 1 | 2 | 3 | 4 | 5;

const OTHER_TONES = 5;

/** The same speaker always gets the same tone, in every note. */
export function speakerTone(name: string): Tone {
  const label = name.trim();
  if (label === "" || label.toLowerCase() === "you") return 0;
  const numbered = /^speaker (\d+)$/i.exec(label);
  if (numbered) {
    // "Speaker 2" is the first other voice on a call (you are speaker 1).
    const index = Math.max(0, Number(numbered[1]) - 2);
    return ((index % OTHER_TONES) + 1) as Tone;
  }
  let hash = 0;
  for (const char of label.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ((hash % OTHER_TONES) + 1) as Tone;
}

/** Everyone heard in a transcript, in order of first appearance. */
export function speakersOf(lines: { speaker: string }[]): string[] {
  const seen: string[] = [];
  for (const { speaker } of lines) if (speaker && !seen.includes(speaker)) seen.push(speaker);
  return seen;
}
