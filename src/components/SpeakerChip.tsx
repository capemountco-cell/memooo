import { speakerTone } from "../lib/speakers";

/** A speaker's name on a soft tint of their colour. */
export function SpeakerChip({ name }: { name: string }) {
  return (
    <span className="speaker" data-tone={speakerTone(name)}>
      <span className="speaker-dot" aria-hidden />
      {name}
    </span>
  );
}
