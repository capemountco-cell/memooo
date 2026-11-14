import { useEffect, useRef, useState } from "react";

export interface NoteMenuTarget {
  id: string;
  x: number;
  y: number;
}

interface Props {
  target: NoteMenuTarget;
  /** The note being recorded can't be deleted until it stops. */
  recording: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/**
 * The right-click menu on a note in the sidebar or the home list. Delete
 * asks once more in place, because the Mac app's web view has no
 * window.confirm.
 */
export function NoteMenu({ target, recording, onOpen, onDelete, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  useEffect(() => {
    if (confirming) ref.current?.querySelector<HTMLButtonElement>(".menu-danger")?.focus();
  }, [confirming]);

  // Keep the menu inside the window.
  const left = Math.min(target.x, window.innerWidth - 200);
  const top = Math.min(target.y, window.innerHeight - 110);

  return (
    <div ref={ref} className="menu" role="menu" style={{ left, top }}>
      {confirming ? (
        <>
          <p className="menu-note">Delete this note for good?</p>
          <button type="button" role="menuitem" className="menu-item menu-danger" onClick={() => onDelete(target.id)}>
            Delete
          </button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button type="button" role="menuitem" className="menu-item" onClick={() => onOpen(target.id)}>
            Open
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-danger"
            disabled={recording}
            title={recording ? "Stop recording first" : undefined}
            onClick={() => setConfirming(true)}
          >
            Delete…
          </button>
        </>
      )}
    </div>
  );
}
