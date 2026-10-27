import Link from "next/link";
import { NEEDS_YOU_SHOWN, emptyNeedsYouNote, type NeedsYou, type NeedsYouItem } from "@/lib/today/needs-you";

const TONE: Record<NeedsYouItem["tone"], string> = { risk: "lx-pill-risk", warn: "lx-pill-warn", ox: "lx-pill-ox", mute: "lx-pill-mute" };

function Row({ n }: { n: NeedsYouItem }) {
  return (
    <li>
      <span className={`lx-pill ${TONE[n.tone]}`}>{n.forYou ? "You" : "Firm"}</span>
      <span style={{ minWidth: 0 }}>
        <Link href={n.href} className="lx-rowlink">
          {n.action}
        </Link>
        <span className="lx-note" style={{ display: "block" }}>
          {n.subject}
          {n.detail ? ` · ${n.detail}` : ""}
          {" · "}
          <Link href={n.href} style={{ fontWeight: 500, color: "var(--ox)", whiteSpace: "nowrap" }}>
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
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }} aria-labelledby="needs-you-h">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="needs-you-h" className="lx-h2" style={{ fontSize: 25 }}>
          Needs you{needs.items.length > 0 && <span className="lx-note" style={{ fontSize: 16 }}> · {needs.items.length}</span>}
        </h2>
        {forYouCount > 0 && <span className="lx-pill lx-pill-ox">{forYouCount} yours</span>}
      </div>
      {needs.items.length > 0 && needs.unavailable.length > 0 && (
        <p className="lx-note" style={{ margin: 0, color: "var(--warn)" }}>
          {needs.unavailable.join(", ")}{" "}couldn&apos;t be read, so this list may be missing items.
        </p>
      )}
      {needs.items.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          {emptyNeedsYouNote(needs, queue)}
        </p>
      ) : (
        <>
          <ol className="lx-list lx-prio">
            {top.map((n) => (
              <Row key={n.key} n={n} />
            ))}
          </ol>
          {rest.length > 0 && (
            <details className="lx-needs-more">
              <summary className="lx-note" style={{ cursor: "pointer", color: "var(--ox)", fontWeight: 500 }}>
                See all {needs.items.length}
              </summary>
              <ol className="lx-list lx-prio" start={NEEDS_YOU_SHOWN + 1} style={{ marginTop: 10 }}>
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
