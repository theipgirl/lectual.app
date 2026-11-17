import "@/components/list-page/list-page.css";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { ListSearch } from "@/components/list-page/ListToolbar";
import { searchPlaceholder } from "@/lib/ui/words";
import { showingOf } from "@/lib/ui/format";
import { PICK_LIMIT, SEARCH_MAX, type PickRecord } from "@/lib/skills/pick";
import type { RecordKind, Skill } from "@/lib/skills/catalog";

/** What one list under a card knows. A failed read is its own state, never an empty list. */
export type PickerGroup = {
  kind: RecordKind;
  read: { status: "ok"; shown: PickRecord[]; total: number } | { status: "failed" };
};

const KIND_PLURAL: Record<RecordKind, string> = { lead: "leads", matter: "matters" };
const KIND_HEADING: Record<RecordKind, string> = { lead: "Leads", matter: "Matters" };

/**
 * "Run it on..." for one card: a plain GET form (it works without JavaScript), then the records as
 * links. The term rides the URL as ?skill=<slug>&q=<term>, so a reload or a shared link shows the same list.
 * Nothing here writes anything: each record is a link to the place the action already lives.
 */
export function SkillPicker({ skill, term, groups }: { skill: Skill; term: string; groups: PickerGroup[] }) {
  const inputId = `pick-${skill.slug}`;
  const showHeadings = groups.length > 1;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* The shared search (placeholder, Search, Clear); a plain GET form so it works without JavaScript and returns to the card. */}
      <ListSearch
        id={inputId}
        label={`Search records to run ${skill.name} on`}
        placeholder={searchPlaceholder(skill.picks.length > 1 ? "by name, mark or number" : skill.picks[0] === "lead" ? "by name, business or email" : "by mark, matter number or client")}
        maxLength={SEARCH_MAX}
        defaultValue={term}
        action={`#skill-${skill.slug}`}
        hidden={{ skill: skill.slug }}
        clearHref={`?skill=${encodeURIComponent(skill.slug)}#skill-${skill.slug}`}
      />
      {groups.map((g) => (
        <div key={g.kind} style={{ display: "grid", gap: 4 }}>
          {showHeadings && <div className="lx-label">{KIND_HEADING[g.kind]}</div>}
          {g.read.status === "failed" ? (
            <LoadFailedLine role="alert">We couldn&apos;t load your {KIND_PLURAL[g.kind]}.</LoadFailedLine>
          ) : g.read.shown.length === 0 ? (
            <p className="lx-note" style={{ margin: 0 }}>
              {term ? `No matches for "${term}".` : `No ${KIND_PLURAL[g.kind]} on file yet.`}
            </p>
          ) : (
            <>
              <ul className="lx-list">
                {g.read.shown.map((r) => (
                  <li key={r.id} style={{ padding: "8px 0" }}>
                    {/* A plain anchor: the href reaches the page exactly as the catalog built it, trailing slash and #anchor included. */}
                    <a href={skill.href(r.kind, r.id)}>{r.label}</a>
                    {r.detail && <span className="lx-note"> · {r.detail}</span>}
                  </li>
                ))}
              </ul>
              <p className="lx-note" style={{ margin: 0 }}>
                {g.read.total > g.read.shown.length
                  ? `${showingOf(g.read.shown.length, g.read.total)}. Type a narrower search to find the one you want.`
                  : `${showingOf(g.read.shown.length, g.read.total)}.`}
              </p>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

export { PICK_LIMIT };
