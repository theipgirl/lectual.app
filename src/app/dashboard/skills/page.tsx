import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { listLeads } from "@/lib/pipeline";
import { listMatters } from "@/lib/matters";
import { canRunSkills, skillAvailable, SKILLS, type RecordKind, type Skill } from "@/lib/skills/catalog";
import { leadRecord, matterRecord, normalizeTerm, pickRecords, type PickRecord } from "@/lib/skills/pick";
import { SkillCard, type CardMode } from "@/components/skills/SkillCard";
import { CoworkSkills } from "@/components/skills/CoworkSkills";
import type { PickerGroup } from "@/components/skills/SkillPicker";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { AI_TOOLS_GROUP, SHORTCUTS_NAME } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(SHORTCUTS_NAME) };

export const dynamic = "force-dynamic";

type Search = { q?: string | string[]; skill?: string | string[] };

/** A list read, in the states it can end in. A failed read is never an empty list. */
type ListRead = { status: "ok"; records: PickRecord[] } | { status: "failed" };

async function readRecords(kind: RecordKind): Promise<ListRead> {
  try {
    const records = kind === "lead" ? (await listLeads()).map(leadRecord) : (await listMatters()).map(matterRecord);
    return { status: "ok", records };
  } catch {
    return { status: "failed" };
  }
}

/** The page: what the staff-run skills do, and a way onto the record each one works on. Reads only. */
export default async function SkillsPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await orgHasModule("agent-toolkit"))) notFound();
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  const params = await searchParams;
  const skillParam = Array.isArray(params.skill) ? params.skill[0] : params.skill;
  // The term belongs to the card it was typed on; every other card shows the recent records.
  const term = normalizeTerm(params.q);

  const [hasDocuments, hasAgents] = await Promise.all([orgHasModule("document-center"), orgHasModule("agents")]);
  const modules = ["agent-toolkit", ...(hasDocuments ? ["document-center"] : []), ...(hasAgents ? ["agents"] : [])];
  const canRun = canRunSkills(session.role);

  // A list is read once, and only when a card that is going to draw a picker needs it.
  const offered = SKILLS.filter((s) => canRun && skillAvailable(s, modules));
  const needs = (kind: RecordKind) => offered.some((s) => s.picks.includes(kind));
  const [leads, matters] = await Promise.all([
    needs("lead") ? readRecords("lead") : Promise.resolve<ListRead | null>(null),
    needs("matter") ? readRecords("matter") : Promise.resolve<ListRead | null>(null),
  ]);

  const cardFor = (skill: Skill): CardMode => {
    if (!skillAvailable(skill, modules)) return { mode: "unavailable" };
    if (!canRun) return { mode: "role" };
    const cardTerm = skillParam === skill.slug ? term : "";
    const groups: PickerGroup[] = skill.picks.map((kind) => {
      const list = kind === "lead" ? leads : matters;
      if (!list || list.status === "failed") return { kind, read: { status: "failed" } };
      return { kind, read: { status: "ok", ...pickRecords(list.records, skill, kind, cardTerm) } };
    });
    return { mode: "picker", term: cardTerm, groups };
  };

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">{AI_TOOLS_GROUP}</div>
          <h1 className="lx-h1">{SHORTCUTS_NAME}</h1>
          <p className="lx-sub">
            The drafting tools the staff already have, in one place. Pick a record and each one opens the form or panel where its
            work happens. Everything they write is held for review: nothing goes to a client until an attorney has read it.
          </p>
        </div>
      </div>

      {!canRun && (
        <p className="lx-note" style={{ margin: 0 }}>
          Your role can&apos;t run skills. You can read what each one does.
        </p>
      )}

      <div className="lx-agrid">
        {SKILLS.map((skill) => (
          <SkillCard key={skill.slug} skill={skill} card={cardFor(skill)} />
        ))}
      </div>

      <CoworkSkills />

      <div className="lx-upl">
        <span aria-hidden="true">§</span>
        <div>
          <b style={{ color: "var(--ox)" }}>The one rule.</b> Shortcuts draft; they never send. An attorney reviews every draft, and
          nothing here answers a legal question.
        </div>
      </div>
    </>
  );
}
