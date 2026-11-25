import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveViewSession } from "@/lib/views/view-as";
import { listStages } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { PageHeader } from "@/components/ui/PageHeader";
import { canMergeLeads } from "@/lib/leads/merge";
import { mergeAvailable } from "@/lib/leads/live";
import { COUNT_SOURCES, MOVE_COUNTS, STAY_COUNTS, leadName, loadMergeView, type Count, type MergeLeadRow } from "@/lib/leads/merge-load";
import { mergeHref } from "@/lib/leads/merge-links";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import { pageTitle } from "@/lib/ui/page-title";
import {
  MERGE_COUNTS_NOTE,
  MERGE_COUNT_LABELS,
  MERGE_COUNT_UNAVAILABLE,
  MERGE_EMPTY_VALUE,
  MERGE_KEEP_INSTEAD,
  MERGE_KEEP_WHY,
  MERGE_KEEPING,
  MERGE_INTO_KEEPER,
  MERGE_LEADS_SUB,
  MERGE_LEADS_TITLE,
  MERGE_LEAD_ALREADY,
  MERGE_LEAD_GONE,
  MERGE_MATTER_NOTE,
  MERGE_MOVES_HEADING,
  MERGE_NOT_A_LEAD,
  MERGE_OPEN_KEEPER,
  MERGE_OPEN_MATTER,
  MERGE_PICK_TWO,
  MERGE_READ_FAILED,
  MERGE_STAGE_LABEL,
  MERGE_STAYS_HEADING,
  INTAKE_NAME,
} from "@/lib/ui/words";
import { MergeForm } from "./MergeForm";
import "../leads.css";
import "./merge.css";
import { intakeListHref } from "@/lib/intake/list-href";

export const metadata: Metadata = { title: pageTitle(MERGE_LEADS_TITLE) };
export const dynamic = "force-dynamic";

const LEAD_COLUMNS =
  "id, first_name, last_name, email, phone, business_name, website, mark_text, referral_source, referral_detail, practice_area, assigned_to, temperature, lane, current_stage_id, lawmatics_id, created_at, merged_into_id";

type Loose = {
  from: (t: string) => {
    select: (c: string, o?: { count: "exact"; head: true }) => {
      eq: (c: string, v: string) => PromiseLike<{ data: unknown; error: unknown; count?: number | null }> & {
        maybeSingle: () => PromiseLike<{ data: unknown; error: unknown }>;
        in: (c: string, v: string[]) => PromiseLike<{ count?: number | null; error: unknown }>;
        limit: (n: number) => PromiseLike<{ data: unknown; error: unknown }>;
      };
    };
  };
};

/**
 * Merge two leads (M5, lectual 0107): owner, admin and senior admin only. Anyone else, signed out included, gets
 * notFound(), and so does a database without 0107 (Merge is hidden there). The action re-checks the role.
 */
export default async function MergeLeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await resolveViewSession();
  if (session.kind !== "ok" || !canMergeLeads(session.role)) notFound();
  const db = await getScopedClient();
  if (!(await mergeAvailable(db))) notFound();

  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const a = one(sp.a);
  const b = one(sp.b);
  const loose = db as unknown as Loose;

  const view = await loadMergeView(a, b, one(sp.keep), {
    lead: async (id) => {
      // live-guard: the merge screen reads both leads with their pointer (merged_into_id is in its column list)
      const { data, error } = await loose.from("crm_lead").select(LEAD_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw new Error("lead read failed");
      return (data as MergeLeadRow | null) ?? null;
    },
    matterExists: async (id) => {
      const { data, error } = await loose.from("crm_matter").select("id").eq("id", id).maybeSingle();
      if (error) throw new Error("matter read failed");
      return !!data;
    },
    matters: async (leadId) => {
      const { data, error } = await loose.from("crm_matter").select("id, title, mark_text, matter_number, owner_name").eq("lead_id", leadId).limit(50);
      if (error || !Array.isArray(data)) throw new Error("matter read failed");
      return (data as { id: string; title: string | null; mark_text: string | null; matter_number: string; owner_name: string | null }[]).map((m) => ({
        id: m.id,
        label: matterDisplayTitle(m).title,
      }));
    },
    count: async (key, leadId) => {
      const source = COUNT_SOURCES[key];
      const base = loose.from(source.table).select("id", { count: "exact", head: true }).eq("lead_id", leadId);
      const { count, error } = await (source.activeOnly ? base.in("status", ["active", "paused"]) : base);
      if (error || typeof count !== "number") throw new Error("count failed");
      return count;
    },
  });

  const header = <PageHeader title={MERGE_LEADS_TITLE} sub={MERGE_LEADS_SUB} back={{ href: intakeListHref(), label: INTAKE_NAME }} />;
  const message = (text: string, link?: { href: string; label: string }) => (
    <div className="mg-page">
      {header}
      <p className="lx-note" role="status">
        {text}
      </p>
      {link && (
        <Link href={link.href} className="lx-btn lx-btn-sec">
          {link.label}
        </Link>
      )}
    </div>
  );

  if (view.status === "bad-ids") return message(MERGE_PICK_TWO);
  if (view.status === "unavailable") return message(MERGE_READ_FAILED);
  if (view.status === "gone") return message(MERGE_LEAD_GONE);
  if (view.status === "not-a-lead") return message(MERGE_NOT_A_LEAD, { href: `/dashboard/matters/${encodeURIComponent(view.matterId)}/`, label: MERGE_OPEN_MATTER });
  if (view.status === "already-merged")
    return message(MERGE_LEAD_ALREADY(view.name), view.keeperId ? { href: `/dashboard/leads/${view.keeperId}/`, label: MERGE_OPEN_KEEPER } : undefined);

  const [stages, members] = await Promise.all([listStages().catch(() => null), listMemberDirectory().catch(() => null)]);
  const stageName = (id: string | null) => (id && stages ? (stages.find((s) => s.id === id)?.name ?? MERGE_EMPTY_VALUE) : MERGE_EMPTY_VALUE);
  const memberName = (id: string | null) => {
    if (!id) return null;
    const m = members?.find((x) => x.userId === id);
    return m ? (m.displayName ?? m.email ?? null) : null;
  };
  const shown = (field: string, value: string | null): string | null => {
    if (!value) return null;
    if (field === "assigned_to") return memberName(value) ?? value;
    if (field === "temperature" || field === "lane") return value.charAt(0).toUpperCase() + value.slice(1);
    return value;
  };

  const { keeper, loser } = view;
  const keeperName = leadName(keeper);
  const loserName = leadName(loser);
  const countText = (c: Count) => (c.status === "ok" ? String(c.count) : MERGE_COUNT_UNAVAILABLE);
  const side = (lead: MergeLeadRow, kept: boolean) => (
    <section className="lx-card mg-card" aria-label={leadName(lead)}>
      <p className="lx-note">{kept ? MERGE_KEEPING : MERGE_INTO_KEEPER}</p>
      <h2 className="lx-h2">
        <Link href={`/dashboard/leads/${lead.id}/`}>{leadName(lead)}</Link>
      </h2>
      <p className="lx-note">{[lead.email, lead.business_name].filter(Boolean).join(" · ") || MERGE_EMPTY_VALUE}</p>
      <p className="lx-note">
        {MERGE_STAGE_LABEL}: {stageName(lead.current_stage_id)}
      </p>
      {kept ? (
        <p className="lx-note">{MERGE_KEEP_WHY[view.why]}</p>
      ) : (
        <div>
          <Link href={mergeHref(keeper.id, loser.id, loser.id)} className="lx-btn lx-btn-sec lx-btn-sm">
            {MERGE_KEEP_INSTEAD}
          </Link>
        </div>
      )}
    </section>
  );

  return (
    <div className="mg-page">
      {header}
      <div className="mg-sides">
        {side(keeper, true)}
        {side(loser, false)}
      </div>
      <div className="mg-counts">
        <section className="lx-card mg-card" aria-labelledby="mg-moves">
          <h2 id="mg-moves" className="lx-h2">
            {MERGE_MOVES_HEADING}
          </h2>
          <ul className="mg-list">
            {MOVE_COUNTS.map((k) => (
              <li key={k}>
                <span>{MERGE_COUNT_LABELS[k]}</span>
                <span>{countText(view.counts[k])}</span>
              </li>
            ))}
          </ul>
          {view.loserMatters?.map((m) => (
            <p key={m.id} className="lx-note">
              {MERGE_MATTER_NOTE(m.label, keeperName)}
            </p>
          ))}
        </section>
        <section className="lx-card mg-card" aria-labelledby="mg-stays">
          <h2 id="mg-stays" className="lx-h2">
            {MERGE_STAYS_HEADING}
          </h2>
          <ul className="mg-list">
            {STAY_COUNTS.map((k) => (
              <li key={k}>
                <span>{MERGE_COUNT_LABELS[k]}</span>
                <span>{countText(view.counts[k])}</span>
              </li>
            ))}
          </ul>
          <p className="lx-note">{MERGE_COUNTS_NOTE}</p>
        </section>
      </div>
      <MergeForm
        keeperId={keeper.id}
        loserId={loser.id}
        keeperName={keeperName}
        loserName={loserName}
        rows={view.fields.map((r) => ({ ...r, keeper: shown(r.field, r.keeper), loser: shown(r.field, r.loser) }))}
      />
    </div>
  );
}
