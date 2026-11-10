import { queueUnavailableCopy, type QueueUnavailableState } from "@/components/queue/QueueUnavailable";
import { DECK_COULDNT_LOAD, DECK_NOT_CONNECTED, DECK_TRY_AGAIN, deckClean } from "@/lib/ui/words";

/** All decided: the one cream check on the second state fill. Two lines, "All decided." then the next deal. */
export function DeckClean({ headline, approved, rejected, waiting }: { headline: string; approved: number; rejected: number; waiting: number }) {
  const cut = headline.indexOf(". ");
  const first = cut >= 0 ? headline.slice(0, cut + 1) : headline;
  const rest = cut >= 0 ? headline.slice(cut + 2) : null;
  return (
    <section className="dk-clean" role="status" aria-label="Clean slate">
      <span className="dk-clean-mark" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24">
          <path d="M5 12l5 5 9-10" />
        </svg>
      </span>
      <p className="dk-clean-title">
        {first}
        {rest ? (
          <>
            <br />
            {rest}
          </>
        ) : null}
      </p>
      <p className="dk-clean-sub">{deckClean(approved, rejected, waiting)}</p>
    </section>
  );
}

/** The queue could not be read (alert on the first fill) or is not switched on (dashed card). Never an empty deal. */
export function DeckUnavailable(props: QueueUnavailableState) {
  const copy = queueUnavailableCopy(props);
  if (props.status === "unavailable") {
    return (
      <div role="alert" className="dk-state dk-state--risk">
        <span className="dk-eyebrow">{DECK_COULDNT_LOAD}</span>
        <p className="dk-state-lead">{copy.title}</p>
        <p className="dk-state-body">{copy.body}</p>
        <a className="dk-state-btn" href="">
          {DECK_TRY_AGAIN}
        </a>
      </div>
    );
  }
  return (
    <div role="status" className="dk-state dk-state--mute">
      <span className="dk-eyebrow">{DECK_NOT_CONNECTED}</span>
      <p className="dk-state-lead">{copy.title}</p>
      <p className="dk-state-body">{copy.body}</p>
    </div>
  );
}

export function DeckEmpty({ headline, details }: { headline: string; details: string[] }) {
  return (
    <div className="dk-empty" role="status">
      <h2>{headline}</h2>
      {details.length > 0 && <p>{details.join(" ")}</p>}
    </div>
  );
}
