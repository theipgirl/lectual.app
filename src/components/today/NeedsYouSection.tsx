import Link from "next/link";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { NEEDS_YOU_SHOWN, emptyNeedsYouNote, type NeedsYou, type NeedsYouItem } from "@/lib/today/needs-you";
import "./today.css";

function Row({ n }: { n: NeedsYouItem }) {
  return (
    <li>
      <Pill tone={n.tone}>{n.forYou ? "You" : "Firm"}</Pill>
      <span className="td-body">
        <Link href={n.href} className="lx-rowlink">
          {n.action}
        </Link>
        <span className="lx-note td-sub">
          {n.subject}
          {n.detail ? ` · ${n.detail}` : ""}
          {" · "}
          <Link href={n.href} className="td-cta">
            {n.cta} →
          </Link>
        </span>
      </span>
    </li>
  );
}

/**
 * Today's "Needs you": the top three, then "See all N" opens the rest in place (a <details>, no navigation),
 * in the same order. The unavailable warning and the empty note are unchanged.
 */
export function NeedsYouSection({ needs, queue }: { needs: NeedsYou; queue: "ok" | "unconfigured" | "unavailable" }) {
  const forYouCount = needs.items.filter((i) => i.forYou).length;
  const top = needs.items.slice(0, NEEDS_YOU_SHOWN);
  const rest = needs.items.slice(NEEDS_YOU_SHOWN);
  return (
    <section className="lx-card td-card" aria-labelledby="needs-you-h">
      <div className="td-head">
        <h2 id="needs-you-h" className="lx-h2">
          Needs you{needs.items.length > 0 && <span className="lx-note td-count"> · {needs.items.length}</span>}
        </h2>
        {forYouCount > 0 && <Pill tone="ox">{forYouCount} yours</Pill>}
      </div>
      {needs.items.length > 0 && needs.unavailable.length > 0 && (
        <Notice tone="warn">
          {needs.unavailable.join(", ")}{" "}couldn&apos;t be read, so this list may be missing items.
        </Notice>
      )}
      {needs.items.length === 0 ? (
        <p className="lx-note lx-state-line">{emptyNeedsYouNote(needs, queue)}</p>
      ) : (
        <>
          <ol className="lx-list lx-prio">
            {top.map((n) => (
              <Row key={n.key} n={n} />
            ))}
          </ol>
          {rest.length > 0 && (
            <details className="lx-needs-more td-more">
              <summary>See all {needs.items.length}</summary>
              <ol className="lx-list lx-prio" start={NEEDS_YOU_SHOWN + 1}>
                {rest.map((n) => (
                  <Row key={n.key} n={n} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
