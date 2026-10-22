import { DRAFTS_ONLY, type Skill } from "@/lib/skills/catalog";
import { SkillPicker, type PickerGroup } from "./SkillPicker";

/** What a card offers. A picker, or the reason it has none. */
export type CardMode =
  | { mode: "picker"; term: string; groups: PickerGroup[] }
  | { mode: "role" }
  | { mode: "unavailable" };

/** One skill: what it does, what it reads, that it only drafts, and the way in. */
export function SkillCard({ skill, card }: { skill: Skill; card: CardMode }) {
  return (
    <section id={`skill-${skill.slug}`} className="lx-card" style={{ padding: 20, display: "grid", gap: 12, alignContent: "start" }}>
      <div>
        <h2 className="lx-h2" style={{ fontSize: 21 }}>
          {skill.name}
        </h2>
        <div className="lx-label" style={{ fontSize: 11, marginTop: 4 }}>
          Reads · {skill.reads}
        </div>
      </div>
      <p style={{ margin: 0, fontSize: 14.5, color: "var(--body)", lineHeight: 1.5 }}>
        {skill.does}
      </p>
      <div>
        <span className="lx-pill lx-pill-mute">{DRAFTS_ONLY}</span>
      </div>
      <div style={{ display: "grid", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
        {card.mode === "picker" ? (
          <>
            <SkillPicker skill={skill} term={card.term} groups={card.groups} />
            <p className="lx-note" style={{ margin: 0 }}>
              Opens {skill.lands}.
              {skill.extra && (
                <>
                  {" "}
                  <a href={skill.extra.href}>{skill.extra.label}</a>{" "}for a meeting that isn&apos;t filed yet.
                </>
              )}
            </p>
          </>
        ) : card.mode === "unavailable" ? (
          <p className="lx-note" style={{ margin: 0 }}>
            Not switched on for this firm.
          </p>
        ) : null}
      </div>
    </section>
  );
}
