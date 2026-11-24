import "./handed.css";
import { Notice } from "@/components/ui/Notice";
import { SendBackForm } from "@/components/queue/SendBackForm";
import { HANDED_NOTE_LABEL, handedToYouAt } from "@/lib/ui/words";

/**
 * Shown on the approval page only when this card is CURRENTLY handed to the viewer: who handed it and when, their
 * note, why the yes may still be someone else's (only when the viewer may not approve it), and Send back.
 */
export function HandedToYouCard({ id, byName, when, note, cantApprove }: { id: string; byName: string; when: string; note: string | null; cantApprove: string | null }) {
  return (
    <section className="lx-card lx-handed" data-handed-to-you aria-label="Handed to you">
      <p className="lx-handed-by">{handedToYouAt(byName, when)}</p>
      {note && (
        <Notice tone="mute">
          <span className="lx-label">{HANDED_NOTE_LABEL}</span>
          <p className="lx-handed-text">{note}</p>
        </Notice>
      )}
      {cantApprove && (
        <div data-handed-cant-approve>
          <Notice tone="mute" role="status">
            {cantApprove}
          </Notice>
        </div>
      )}
      <SendBackForm id={id} name={byName} />
    </section>
  );
}
