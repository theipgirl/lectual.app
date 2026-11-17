import { Notice } from "@/components/ui/Notice";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/Icon";
import { queueUnavailableCopy, type QueueUnavailableState } from "@/components/queue/QueueUnavailable";
import { DECK_COULDNT_LOAD, DECK_NOT_CONNECTED, DECK_TRY_AGAIN, deckClean } from "@/lib/ui/words";

/** All decided: the one cream check on the second state fill. Two lines, "All decided." then the next deal. */
export function DeckClean({ headline, approved, rejected, done, waiting }: { headline: string; approved: number; rejected: number; done: number; waiting: number }) {
  const cut = headline.indexOf(". ");
  const first = cut >= 0 ? headline.slice(0, cut + 1) : headline;
  const rest = cut >= 0 ? headline.slice(cut + 2) : null;
  return (
    <section className="dk-clean" role="status" aria-label="Clean slate">
      <span className="dk-clean-mark" aria-hidden="true">
        <Icon name="check" size={28} />
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
      <p className="dk-clean-sub">{deckClean(approved, rejected, waiting, done)}</p>
    </section>
  );
}

/** The queue could not be read (alert on the first fill) or is not switched on (dashed card). Never an empty deal. */
export function DeckUnavailable(props: QueueUnavailableState) {
  const copy = queueUnavailableCopy(props);
  if (props.status === "unavailable") {
    return (
      <Notice tone="risk" role="alert" title={DECK_COULDNT_LOAD} action={<a className="lx-btn lx-btn-sec lx-btn-sm" href="">{DECK_TRY_AGAIN}</a>}>
        <span className="dk-state-lead">{copy.title}</span> <span>{copy.body}</span>
      </Notice>
    );
  }
  return (
    <Notice tone="mute" role="status" title={DECK_NOT_CONNECTED}>
      <span className="dk-state-lead">{copy.title}</span> <span>{copy.body}</span>
    </Notice>
  );
}

export function DeckEmpty({ headline, details }: { headline: string; details: string[] }) {
  return (
    <div role="status">
      <EmptyState title={headline}>{details.join(" ")}</EmptyState>
    </div>
  );
}
