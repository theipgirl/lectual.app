import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import { loadTemperatureFacts } from "@/lib/intake/facts";
import { loadLeadStepFacts } from "@/lib/lead-step/load";
import { mergeAvailable, mergedSetFor, resolveLeadId } from "@/lib/leads/live";
import { getMatter } from "@/lib/matters/matters";
import { listMatterDeadlines } from "@/lib/matters/deadlines";
import { listMatterStages } from "@/lib/matters/stages";
import { listMemberDirectory } from "@/lib/members/directory";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { getLead } from "@/lib/pipeline/leads";
import { listStages } from "@/lib/pipeline/stages";
import { listTags, tagsForLead } from "@/lib/pipeline/tags";
import { listProposals } from "@/lib/proposals/store";
import { readRecordDocuments } from "@/lib/review/detail-load";
import type { ActivityRow } from "@/lib/stage-keeper/moves";
import { RECORD_CARD_A_TEAMMATE } from "@/lib/ui/words";
import { nextOpenDeadline, type CardMember, type CardProposal, type CardRead, type CardStage, type CardTag, type CardTask, type RecordCardLoad } from "./model";
import type { CardRef } from "./open";
import { approvalQueueIds } from "./rules";

/**
 * Re-reads ONE record for the opened card (`?open=`), through the caller's scoped client only: no service role, no
 * write. The record itself is the gate: an id the scoped read can't see (another firm's, or a random one) is
 * `not-found`, and nothing else is read for it. A merged lead is followed to its keeper, as the lead page does. Every
 * other source is its own three-state read (ok / not set up / couldn't be read) and never reads as "none". Never throws.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_ZONE = "America/New_York";
/** The same cap as the lead page's timeline. */
const ACTIVITY_CAP = 100;

const ok = <T>(value: T): CardRead<T> => ({ status: "ok", value });
const UNAVAILABLE = { status: "unavailable" } as const;
const NOT_SET_UP = { status: "not-set-up" } as const;

async function settle<T>(work: () => Promise<CardRead<T>>): Promise<CardRead<T>> {
  try {
    return await work();
  } catch {
    return UNAVAILABLE;
  }
}

async function readMembers(): Promise<CardRead<CardMember[]>> {
  const rows = await listMemberDirectory();
  return ok(rows.map((m) => ({ userId: m.userId, name: (m.displayName ?? "").trim() || (m.email ?? "").trim() || RECORD_CARD_A_TEAMMATE })));
}

async function readTimeZone(): Promise<string> {
  try {
    return await getFirmTimeZone();
  } catch {
    // The review page's own fallback when the firm's zone can't be read.
    return FALLBACK_ZONE;
  }
}

async function readDocuments(ref: CardRef): Promise<CardRead<Awaited<ReturnType<typeof readRecordDocuments>>>> {
  // The loader reports each of its own reads (files, letters, merged part) inside; a throw here is the whole read failing.
  return ok(await readRecordDocuments(ref));
}

export type LoadOptions = {
  now?: Date;
  /** A possible duplicate the PAGE found (its own duplicate rule), for the Merge link. Never taken from the browser. */
  duplicateOf?: string | null;
};

export async function loadRecordCard(ref: CardRef, opts: LoadOptions = {}): Promise<RecordCardLoad> {
  const now = opts.now ?? new Date();
  if (!UUID.test(ref.id)) return { status: "not-found" };
  try {
    const session = await resolveFirmSession();
    if (session.kind !== "ok") return { status: "unavailable" };
    const db = await getScopedClient();
    return ref.kind === "lead" ? await loadLead(db, ref.id, session.role, now, opts) : await loadMatter(ref.id, session.role, now);
  } catch {
    return { status: "unavailable" };
  }
}

type Role = Extract<Awaited<ReturnType<typeof resolveFirmSession>>, { kind: "ok" }>["role"];

async function loadLead(db: Awaited<ReturnType<typeof getScopedClient>>, askedId: string, role: Role, now: Date, opts: LoadOptions): Promise<RecordCardLoad> {
  // A merged lead (lectual 0107) is not a record of its own: the card shows the lead it was merged into.
  const followed = await resolveLeadId(db, askedId);
  if (followed.status === "not-found") return { status: "not-found" };
  if (followed.status !== "ok") return { status: "unavailable" };
  const lead = await getLead(followed.id);
  if (!lead) return { status: "not-found" };

  // Only after the record itself was read through RLS above: a foreign or missing id never gets here.
  const [stages, members, tags, leadStep, documents, modules, merge, timeZone] = await Promise.all([
    settle<CardStage[]>(async () => ok(await listStages())),
    settle(readMembers),
    settle<{ on: CardTag[]; catalog: CardTag[] }>(async () => {
      const [on, catalog] = await Promise.all([tagsForLead(lead.id), listTags()]);
      const tag = (t: { id: string; label: string; color: string | null }): CardTag => ({ id: t.id, label: t.label, color: t.color });
      return ok({ on: on.map(tag), catalog: catalog.map(tag) });
    }),
    loadLeadStepFacts(lead.id, now).catch(() => ({ status: "unavailable" as const })),
    settle(() => readDocuments({ kind: "lead", id: lead.id })),
    activeOrgModulesOrNull().catch(() => null),
    mergeAvailable(db).catch(() => false),
    readTimeZone(),
  ]);

  const facts = leadStep.status === "ok" ? leadStep.facts : null;

  const proposal = await settle<CardProposal | null>(async () => {
    if (modules === null) return UNAVAILABLE;
    if (!modules.includes("proposals")) return NOT_SET_UP;
    // Proposals are read across the merged set, as the lead page does. Never for the keeper alone when the set is
    // unknown: a proposal filed on a merged lead would then read as "none". The engine's set when it has it whole,
    // else the set read directly; still unknown = couldn't be read.
    let leadIds: string[];
    if (facts && !facts.lead.mergedPartial && facts.lead.mergedIds.length > 0) leadIds = facts.lead.mergedIds;
    else {
      const set = await mergedSetFor(db, lead.id);
      if (set.status !== "ok") return UNAVAILABLE;
      leadIds = set.ids.length > 0 ? set.ids : [lead.id];
    }
    const list = await listProposals(leadIds.length > 1 ? { leadIds } : { leadId: leadIds[0] });
    const p = list[0];
    return ok(p ? { id: p.id, version: p.version, status: p.status, legalCents: p.legal_total_cents, govCents: p.gov_total_cents } : null);
  });

  // The temperature the Intake page shows: the same facts, read the same way. A failed facts read builds without them, as the page does.
  let temperature: Extract<RecordCardLoad, { kind: "lead" }>["temperature"] = null;
  if (stages.status === "ok") {
    const stageRows = stages.value as Parameters<typeof effectiveTemperature>[1];
    let factsRead: Awaited<ReturnType<typeof loadTemperatureFacts>> = { status: "unavailable" };
    try {
      factsRead = await loadTemperatureFacts([lead], stageRows);
    } catch {
      // stays unavailable
    }
    temperature = effectiveTemperature(lead, stageRows, now, factsRead.status === "ok" ? factsRead.byLead[lead.id] : undefined);
  }

  const approvals: Extract<RecordCardLoad, { kind: "lead" }>["approvals"] = !facts
    ? { status: "unavailable" }
    : facts.approvals.status === "ok"
      ? { status: "ok", queueIds: approvalQueueIds(facts.approvals.value) }
      : facts.approvals.status === "not-set-up"
        ? { status: "unconfigured" }
        : { status: "unavailable" };

  const duplicateOf = opts.duplicateOf && UUID.test(opts.duplicateOf) && opts.duplicateOf.toLowerCase() !== lead.id.toLowerCase() ? opts.duplicateOf : null;

  return {
    status: "ok",
    kind: "lead",
    role,
    now: now.toISOString(),
    timeZone: facts?.timeZone ?? timeZone,
    lead: {
      id: lead.id,
      first_name: lead.first_name,
      last_name: lead.last_name,
      business_name: lead.business_name,
      mark_text: lead.mark_text ?? null,
      email: lead.email,
      phone: lead.phone,
      current_stage_id: lead.current_stage_id,
      assigned_to: lead.assigned_to,
      referral_source: lead.referral_source,
      last_activity_at: lead.last_activity_at,
      last_inbound_at: lead.last_inbound_at,
      last_outbound_at: lead.last_outbound_at,
      lane: lead.lane ?? null,
      lane_set_at: lead.lane_set_at ?? null,
      ai_summary: lead.ai_summary,
    },
    stages,
    members,
    tags,
    leadStep: leadStep.status === "ok" ? leadStep : leadStep.status === "not-found" ? { status: "not-found" } : { status: "unavailable" },
    approvals,
    proposal,
    documents,
    temperature,
    mergeAvailable: merge === true,
    duplicateOf,
  };
}

async function loadMatter(id: string, role: Role, now: Date): Promise<RecordCardLoad> {
  const matter = await getMatter(id);
  if (!matter) return { status: "not-found" };
  const db = await getScopedClient();

  // Only after the matter itself was read through RLS above.
  const [stages, members, tasks, activity, deadline, documents, timeZone] = await Promise.all([
    settle<CardStage[]>(async () => ok((await listMatterStages()).map((s) => ({ id: s.id, label: s.label })))),
    settle(readMembers),
    settle<CardTask[]>(async () => {
      const { data, error } = await db
        .from("crm_task")
        .select("id, title, due_at, assignee_id, created_at")
        .eq("status", "open")
        .eq("matter_id", matter.id)
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (error) return UNAVAILABLE;
      return ok((data ?? []).map((t) => ({ id: t.id, title: t.title, dueAt: t.due_at, assigneeId: t.assignee_id })));
    }),
    settle<{ rows: ActivityRow[]; truncated: boolean }>(async () => {
      const { data, error } = await db
        .from("crm_activity")
        .select("id, lead_id, matter_id, type, actor_type, created_at, payload")
        .eq("matter_id", matter.id)
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_CAP + 1);
      if (error) return UNAVAILABLE;
      const rows = (data ?? []) as unknown as ActivityRow[];
      return ok({ rows: rows.slice(0, ACTIVITY_CAP), truncated: rows.length > ACTIVITY_CAP });
    }),
    settle(async () => ok(nextOpenDeadline(await listMatterDeadlines(matter.id)))),
    settle(() => readDocuments({ kind: "matter", id: matter.id })),
    readTimeZone(),
  ]);

  return {
    status: "ok",
    kind: "matter",
    role,
    now: now.toISOString(),
    timeZone,
    matter: {
      id: matter.id,
      title: matter.title,
      mark_text: matter.mark_text,
      owner_name: matter.owner_name,
      matter_number: matter.matter_number,
      stage_id: matter.stage_id,
      assigned_to: matter.assigned_to,
      referral_source: matter.referral_source,
      type: matter.type ?? null,
      lead_id: matter.lead_id ?? null,
    },
    stages,
    members,
    tasks,
    activity,
    deadline,
    documents,
  };
}
