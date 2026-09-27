import Link from "next/link";
import { notFound } from "next/navigation";
import { currentRole } from "@/lib/auth/current-role";
import {
  AUTOMATION_ADMIN_ROLES,
  AUTOMATION_STAFF_ROLES,
  getSequence,
  listEnrollments,
  listSteps,
  listTemplates,
} from "@/lib/automation";
import { listLeads } from "@/lib/pipeline";
import {
  delayLabel,
  enrollmentStatusLabel,
  enrollmentStatusTone,
  isStepDue,
  leadDisplayName,
  sequenceStatusLabel,
  sequenceStatusTone,
  stepTypeLabel,
} from "@/lib/campaigns/steps";
import { relativeTime } from "@/lib/relative-time";
import {
  AddStepForm,
  DeleteStepButton,
  EditSequenceForm,
  EnrollLeadForm,
  EnrollmentActions,
  ToggleSequenceButton,
} from "./_components/CampaignBuilderForms";
import "../campaigns.css";

export const dynamic = "force-dynamic";

/**
 * One campaign's builder: its details, its ordered steps, and everyone
 * enrolled in it (which doubles as this campaign's activity view — every
 * lead's current step and status, newest-enrolled first).
 *
 * ── THREE READS, EACH DEGRADES ON ITS OWN ────────────────────────────────────
 * Steps, enrollments and templates are independent reads; this page is one
 * of the few in the app where a failure in ANY of them should still show
 * what did load rather than blanking the whole page — a firm reviewing steps
 * should not lose that view because the enrollments read hiccupped. Each
 * failure renders its own inline notice, never a silent empty list.
 *
 * ── WHO MAY DO WHAT ───────────────────────────────────────────────────────
 * `canManage` (owner/admin/senior_admin, AUTOMATION_ADMIN_ROLES) gates the
 * sequence's shape: name/description, pause/start, adding or removing
 * steps — mirrors crm_drip_sequence/crm_drip_step's `*_admin` RLS. `canOperate`
 * (AUTOMATION_STAFF_ROLES, everyone except social_media/viewer) gates the
 * operational side: enrolling a lead, pausing/resuming/cancelling an
 * enrollment, and running a step — mirrors crm_drip_enrollment's `*_staff`
 * RLS. Every action re-checks its own gate; these flags only decide what
 * this page renders.
 */
export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const role = await currentRole();
  const canManage = role !== null && AUTOMATION_ADMIN_ROLES.includes(role);
  const canOperate = role !== null && AUTOMATION_STAFF_ROLES.includes(role);

  const sequence = await getSequence(id);
  if (!sequence) notFound();

  const [stepsRead, enrollmentsRead, templatesRead, leadsRead] = await Promise.all([
    listSteps(id).then((steps) => ({ steps, error: null as string | null })).catch((err) => ({
      steps: [],
      error: err instanceof Error ? err.message : "Couldn't load this campaign's steps.",
    })),
    listEnrollments({ sequenceId: id }).then((enrollments) => ({ enrollments, error: null as string | null })).catch((err) => ({
      enrollments: [],
      error: err instanceof Error ? err.message : "Couldn't load who's enrolled.",
    })),
    listTemplates().catch(() => []),
    // Fetched even for a view-only role: this is what turns an enrollment's
    // raw lead_id into a readable name below, not only the enroll picker.
    listLeads().catch(() => []),
  ]);

  const steps = stepsRead.steps;
  const enrollments = enrollmentsRead.enrollments;
  const templateOptions = templatesRead.map((t) => ({ id: t.id, name: t.name, subject: t.subject }));
  const templateById = new Map(templatesRead.map((t) => [t.id, t]));
  const leadById = new Map(leadsRead.map((lead) => [lead.id, lead]));

  const alreadyEnrolledLeadIds = new Set(enrollments.map((e) => e.lead_id));
  const leadOptions = leadsRead
    .filter((lead) => !alreadyEnrolledLeadIds.has(lead.id))
    .map((lead) => ({ id: lead.id, label: `${leadDisplayName(lead)} — ${lead.email || "no email"}`, hasEmail: !!lead.email }));

  const now = new Date();

  return (
    <>
      <Link href="/dashboard/campaigns/" className="lx-back">
        ← Campaigns
      </Link>

      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`lx-pill ${sequenceStatusTone(sequence.active)}`}>{sequenceStatusLabel(sequence.active)}</span>
          </div>
          <h1 className="lx-h1">{sequence.name}</h1>
          {sequence.description && <p className="lx-sub">{sequence.description}</p>}
        </div>
        {canManage && <ToggleSequenceButton sequenceId={sequence.id} active={sequence.active} />}
      </div>

      {canManage && (
        <details className="lx-card lx-disclosure-inline" style={{ padding: 16 }}>
          <summary>Edit name &amp; description</summary>
          <EditSequenceForm sequenceId={sequence.id} name={sequence.name} description={sequence.description} />
        </details>
      )}

      <section className="lx-card lx-band">
        <header className="lx-band-head">
          <h2 className="lx-h2">Sequence</h2>
          <span className="lx-note">{steps.length} step{steps.length === 1 ? "" : "s"}</span>
        </header>
        {stepsRead.error ? (
          <p className="lx-note lx-campaigns-inlineerror">{stepsRead.error}</p>
        ) : steps.length === 0 ? (
          <p className="lx-note" style={{ padding: "0 18px 14px" }}>
            No steps yet. {canManage ? "Add the first one below." : "An admin hasn't added any yet."}
          </p>
        ) : (
          <ol className="lx-campaigns-steps">
            {steps.map((step, index) => {
              const template = step.template_id ? templateById.get(step.template_id) : null;
              const config = (step.config ?? {}) as Record<string, unknown>;
              return (
                <li key={step.id} className="lx-campaigns-step">
                  <span className="lx-campaigns-step-ix">{index + 1}</span>
                  <div className="lx-campaigns-step-body">
                    <div className="lx-campaigns-step-top">
                      <span className="lx-pill lx-pill-mute">{stepTypeLabel(step.type)}</span>
                      <span className="lx-note">{delayLabel(step.delay_hours)}{index === 0 ? " after enrolling" : " after the step before it"}</span>
                    </div>
                    {step.type === "email" && (
                      <div className="lx-note">
                        {template ? (
                          <>
                            Template: <strong>{template.name}</strong> — {template.subject}
                          </>
                        ) : (
                          <span style={{ color: "var(--wine)" }}>No template attached — this step can&apos;t run yet.</span>
                        )}
                      </div>
                    )}
                    {step.type === "task" && (
                      <div className="lx-note">
                        Creates: {typeof config.title === "string" && config.title ? config.title : "a follow-up task on the lead"}
                      </div>
                    )}
                    {step.type === "wait" && <div className="lx-note">No action — just a delay before the next step.</div>}
                    {step.type === "condition" && (
                      <div className="lx-note">Logged only — this schema has no branch target, so a condition step never skips ahead on its own.</div>
                    )}
                  </div>
                  {canManage && <DeleteStepButton sequenceId={sequence.id} stepId={step.id} />}
                </li>
              );
            })}
          </ol>
        )}
        {canManage && (
          <div style={{ padding: "0 18px 18px" }}>
            <AddStepForm sequenceId={sequence.id} templates={templateOptions} />
          </div>
        )}
      </section>

      <section className="lx-card lx-band">
        <header className="lx-band-head">
          <h2 className="lx-h2">Enrolled</h2>
          <span className="lx-note">{enrollments.length} lead{enrollments.length === 1 ? "" : "s"} · this is also this campaign&apos;s activity</span>
        </header>
        {canOperate && (
          <div style={{ padding: "0 18px 14px" }}>
            <EnrollLeadForm sequenceId={sequence.id} leads={leadOptions} />
          </div>
        )}
        {enrollmentsRead.error ? (
          <p className="lx-note lx-campaigns-inlineerror">{enrollmentsRead.error}</p>
        ) : enrollments.length === 0 ? (
          <p className="lx-note" style={{ padding: "0 18px 18px" }}>
            Nobody is enrolled yet.
          </p>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table className="lx-tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Status</th>
                  <th>Step</th>
                  <th>Next</th>
                  <th>Enrolled</th>
                  {canOperate && <th />}
                </tr>
              </thead>
              <tbody>
                {enrollments.map((enrollment) => {
                  const due = isStepDue(enrollment.next_step_at, now);
                  const lead = leadById.get(enrollment.lead_id);
                  return (
                    <tr key={enrollment.id}>
                      <td className="pri wrap">
                        {/* NOT lx-rowlink: that class overlays the whole <tr> (see
                            .lx-rowlink::after in globals.css) so the row itself
                            navigates — right for a list with no other controls,
                            but this row also carries the actions in the last
                            column, and the overlay would swallow every click on
                            them. */}
                        <Link href={`/dashboard/leads/${enrollment.lead_id}/`} style={{ color: "var(--ink)", fontWeight: 500 }}>
                          {lead ? leadDisplayName(lead) : "Lead no longer visible"}
                        </Link>
                        {lead?.email && <div className="lx-note">{lead.email}</div>}
                      </td>
                      <td>
                        <span className={`lx-pill ${enrollmentStatusTone(enrollment.status)}`}>{enrollmentStatusLabel(enrollment.status)}</span>
                      </td>
                      <td className="lx-num">
                        {enrollment.current_step} / {steps.length}
                        {enrollment.current_step >= steps.length && steps.length > 0 && enrollment.status === "active" ? (
                          <span className="lx-note"> · done, closing out</span>
                        ) : null}
                      </td>
                      <td className="lx-note">
                        {enrollment.status !== "active"
                          ? "—"
                          : enrollment.next_step_at
                            ? due
                              ? "Due now"
                              : new Date(enrollment.next_step_at).toLocaleString()
                            : "Ready to run"}
                      </td>
                      <td className="lx-num">{relativeTime(enrollment.enrolled_at)}</td>
                      {canOperate && (
                        <td>
                          <EnrollmentActions
                            sequenceId={sequence.id}
                            enrollmentId={enrollment.id}
                            status={enrollment.status}
                            hasMoreSteps={enrollment.current_step < steps.length}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="lx-note lx-campaigns-firmnote">
        Nothing sends on its own. Running an email step drafts it into the approval queue from the template above —
        review it on the <Link href="/dashboard/queue/">Queue</Link> before it reaches anyone.
      </p>
    </>
  );
}
