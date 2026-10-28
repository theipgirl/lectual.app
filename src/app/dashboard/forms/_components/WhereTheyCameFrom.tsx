import { DIRECT_LABEL, NO_CAMPAIGN_LABEL, groupBySource } from "@/lib/intake-forms/where-from";
import { RESULT_ROW_LIMIT } from "@/lib/intake-forms/load-results";
import { notReadyYet } from "@/lib/ui/words";

/**
 * Results → "Where they came from". Three states like the other blocks: the
 * table, "can't show", or the not-switched-on sentence. An unreadable read is
 * never drawn as an empty table or a zero. Source codes and campaigns are
 * React text (escaped), shown as typed unless they match a channel preset.
 */

export type WhereFromState =
  | { status: "ok"; rows: readonly { contact: unknown }[]; capped: boolean }
  | { status: "unavailable" }
  | { status: "unconfigured" };

export function WhereTheyCameFrom({ state }: { state: WhereFromState }) {
  return (
    <section className="ifm-card ifr-where" aria-label="Where they came from">
      <h3 className="ifm-title">Where they came from</h3>
      <Body state={state} />
    </section>
  );
}

function Body({ state }: { state: WhereFromState }) {
  if (state.status === "unconfigured") return <p className="ifm-help">{notReadyYet("Forms")}</p>;
  if (state.status === "unavailable") return <p className="ifm-help" role="status">Can&apos;t show where people came from right now. Refresh to try again.</p>;
  const w = groupBySource(state.rows);
  return (
    <>
      <table className="ifr-where-table">
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">People</th>
          </tr>
        </thead>
        <tbody>
          {w.groups.map((g) => (
            <SourceRows key={g.source} group={g} />
          ))}
          <tr>
            <th scope="row">{DIRECT_LABEL}</th>
            <td>{w.direct.toLocaleString("en-US")}</td>
          </tr>
        </tbody>
      </table>
      <p className="ifm-help">{`${w.total.toLocaleString("en-US")} ${w.total === 1 ? "person" : "people"} in this range.`}</p>
      {state.capped && <p className="ifm-help">{`This covers the latest ${RESULT_ROW_LIMIT.toLocaleString("en-US")} people in this range.`}</p>}
    </>
  );
}

function SourceRows({ group }: { group: ReturnType<typeof groupBySource>["groups"][number] }) {
  return (
    <>
      <tr>
        <th scope="row">{group.label}</th>
        <td>{group.count.toLocaleString("en-US")}</td>
      </tr>
      {group.campaigns.map((c) => (
        <tr key={c.campaign ?? "none"} className="ifr-where-sub">
          <th scope="row">{c.campaign ?? NO_CAMPAIGN_LABEL}</th>
          <td>{c.count.toLocaleString("en-US")}</td>
        </tr>
      ))}
    </>
  );
}
