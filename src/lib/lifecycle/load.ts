import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listLeads, listStages, type Lead } from "@/lib/pipeline";
import { listMatters, listMatterStages, leadDisplayName, matterLabel } from "@/lib/matters";
import { listMemberDirectory } from "@/lib/members/directory";
import {
  ageInDays,
  leadColumn,
  mapDocketStages,
  mapLeadStages,
  matterColumn,
  type PipelineCard,
} from "./columns";

/**
 * Everything the pipeline board reads, through the caller's scoped client.
 *
 * Two halves, each with its own state, because they come from different
 * tables and one failing must not blank the other or, worse, render as an
 * empty column: pre-engagement (lead stages + leads + intake submissions) and
 * post-engagement (docket stages + matters). A half that couldn't be read is
 * `unavailable`, and the board says so over those columns instead of drawing
 * zeros.
 */
export type PipelineLoad = {
  leads: "ok" | "unavailable";
  matters: "ok" | "unavailable";
  cards: PipelineCard[];
  owners: { id: string; name: string }[];
  /** Partial-read caveats that don't blank a half ("consult notes couldn't be read"). */
  notes: string[];
};

type SubmissionRow = { id: string; contact: unknown; status: string; submitted_at: string | null; created_at: string };

function submissionName(contact: unknown): string {
  const c = (contact && typeof contact === "object" ? contact : {}) as Record<string, unknown>;
  const str = (k: string) => (typeof c[k] === "string" ? (c[k] as string).trim() : "");
  return str("business_name") || str("business") || `${str("first_name")} ${str("last_name")}`.trim() || str("name") || str("email") || "Intake form submission";
}

export async function loadPipeline(now: Date = new Date()): Promise<PipelineLoad> {
  const supabase = await getScopedClient();
  const [leadStagesS, leadsS, notesS, subsS, docketS, mattersS, membersS] = await Promise.allSettled([
    listStages(),
    listLeads(),
    (async () => {
      const { data, error } = await supabase.from("crm_consult_note").select("lead_id").not("lead_id", "is", null);
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.lead_id as string));
    })(),
    (async () => {
      // Public-form submissions not yet turned into a lead. Written by the server (0075); staff read.
      const { data, error } = await supabase
        .from("crm_intake_submission")
        .select("id, contact, status, submitted_at, created_at")
        .is("lead_id", null)
        .not("submitted_at", "is", null)
        .in("status", ["new", "referred", "consult_booked"])
        .limit(200);
      if (error) throw error;
      return (data ?? []) as SubmissionRow[];
    })(),
    listMatterStages(),
    listMatters(),
    listMemberDirectory(),
  ]);

  const notes: string[] = [];
  const members = membersS.status === "fulfilled" ? membersS.value : [];
  const memberName = new Map(members.map((m) => [m.userId, m.displayName || m.email || "Team member"]));
  const cards: PipelineCard[] = [];

  const leadsOk = leadStagesS.status === "fulfilled" && leadsS.status === "fulfilled";
  const mattersOk = docketS.status === "fulfilled" && mattersS.status === "fulfilled";
  const leads: Lead[] = leadsS.status === "fulfilled" ? leadsS.value : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  // A lead that has become a matter is shown once, as the matter.
  const leadsWithMatter = new Set(mattersS.status === "fulfilled" ? mattersS.value.map((m) => m.lead_id).filter(Boolean) as string[] : []);

  if (leadsOk) {
    const stageMap = mapLeadStages(leadStagesS.value);
    const stageName = new Map(leadStagesS.value.map((s) => [s.id, s.name]));
    const consulted = notesS.status === "fulfilled" ? notesS.value : new Set<string>();
    if (notesS.status === "rejected") notes.push("Consult notes couldn't be read, so a lead whose consult is recorded only as a note may show under New intake.");
    for (const lead of leads) {
      if (leadsWithMatter.has(lead.id)) continue;
      cards.push({
        key: `l-${lead.id}`,
        kind: "lead",
        column: leadColumn(stageMap, lead, consulted.has(lead.id)),
        client: leadDisplayName(lead) ?? lead.email,
        mark: lead.mark_text,
        ref: "Lead",
        stageLabel: stageName.get(lead.current_stage_id) ?? null,
        ageDays: ageInDays(lead.stage_entered_at, now),
        ownerId: lead.assigned_to,
        ownerName: lead.assigned_to ? memberName.get(lead.assigned_to) ?? null : null,
        href: `/dashboard/leads/${lead.id}/`,
      });
    }
    if (subsS.status === "fulfilled") {
      for (const s of subsS.value) {
        cards.push({
          key: `s-${s.id}`,
          kind: "submission",
          column: s.status === "consult_booked" ? "consult" : "intake",
          client: submissionName(s.contact),
          mark: null,
          ref: s.status === "referred" ? "Referral" : "Intake form",
          stageLabel: s.status === "new" ? "Not reviewed yet" : s.status === "referred" ? "Referred" : "Consult booked",
          ageDays: ageInDays(s.submitted_at ?? s.created_at, now),
          ownerId: null,
          ownerName: null,
          href: "/dashboard/forms/",
        });
      }
    } else {
      notes.push("Intake-form submissions couldn't be read, so referrals not yet turned into leads are missing.");
    }
  }

  if (mattersOk) {
    const stageMap = mapDocketStages(docketS.value);
    for (const m of mattersS.value) {
      const lead = m.lead_id ? leadById.get(m.lead_id) : undefined;
      const client = leadDisplayName(lead) || m.owner_name?.trim() || matterLabel(m);
      cards.push({
        key: `m-${m.id}`,
        kind: "matter",
        column: matterColumn(stageMap, m),
        client,
        mark: m.mark_text,
        ref: m.matter_number,
        stageLabel: m.stage ? m.stage.label : "Not on the docket",
        ageDays: ageInDays(m.stage_entered_at, now),
        ownerId: m.assigned_to,
        ownerName: m.assigned_to ? memberName.get(m.assigned_to) ?? null : null,
        href: `/dashboard/matters/${m.id}/`,
      });
    }
  }

  const ownerIds = new Set(cards.map((c) => c.ownerId).filter(Boolean) as string[]);
  const owners = [...ownerIds].map((id) => ({ id, name: memberName.get(id) ?? "Team member" })).sort((a, b) => a.name.localeCompare(b.name));

  return { leads: leadsOk ? "ok" : "unavailable", matters: mattersOk ? "ok" : "unavailable", cards, owners, notes };
}
