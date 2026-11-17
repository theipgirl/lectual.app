import { COWORK_SKILLS } from "@/lib/skills/catalog";

/**
 * The shortcuts that run in Claude, not here. Text only: no button, no form and no link, because nothing
 * on this page can start them.
 */
export function CoworkSkills() {
  return (
    <section className="lx-card lx-pad" style={{ display: "grid", gap: 10 }} aria-labelledby="cowork-skills-title">
      <h2 id="cowork-skills-title" className="lx-h2">
        In Claude (Cowork plugin)
      </h2>
      <p className="lx-note">
        These run in Claude, not in this app. Nothing on this page starts them.
      </p>
      <ul className="lx-list">
        {COWORK_SKILLS.map((s) => (
          <li key={s.name} style={{ padding: "8px 0", color: "var(--ink)" }}>
            <b>{s.name}</b> <span className="lx-note">{s.line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
