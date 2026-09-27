/**
 * Pure helpers for the Campaigns feature (crm_drip_sequence / crm_drip_step /
 * crm_drip_enrollment / crm_email_template — schema and role gates live in
 * @/lib/automation/drips.ts and @/lib/automation/rules.ts). Nothing here
 * touches the database, so it is unit-tested directly.
 *
 * ── TEMPLATE RENDERING IS TEXT SUBSTITUTION, NOT A MODEL ────────────────────
 * `{{first_name}}`-style tokens are replaced from a fixed set of lead fields.
 * An unknown token is left exactly as typed rather than silently dropped —
 * a firm that mistypes `{{frist_name}}` sees the mistake in the drafted
 * email (which is exactly what it will be, since nothing sends until a human
 * approves it), not a blank space where the client's name should be.
 */

import type { DripEnrollmentStatus, DripStepType } from "@/lib/automation/drips";

export type { DripEnrollmentStatus, DripStepType };

export type TemplateLead = {
  first_name: string;
  last_name: string;
  business_name: string | null;
  email: string;
};

export type RenderableTemplate = {
  subject: string;
  body_html: string;
  body_text: string;
};

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** The client-facing display name: business name if there is one, else the person's full name. */
export function leadDisplayName(lead: Pick<TemplateLead, "first_name" | "last_name" | "business_name">): string {
  const business = lead.business_name?.trim();
  if (business) return business;
  return `${lead.first_name} ${lead.last_name}`.trim();
}

/** The variables a template's `{{token}}`s may draw on for one lead. */
export function leadTemplateVars(lead: TemplateLead): Record<string, string> {
  const fullName = `${lead.first_name} ${lead.last_name}`.trim();
  return {
    first_name: lead.first_name ?? "",
    last_name: lead.last_name ?? "",
    full_name: fullName,
    business_name: lead.business_name ?? "",
    client_name: leadDisplayName(lead),
    email: lead.email ?? "",
  };
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(TOKEN, (whole, key: string) => (key in vars ? vars[key] : whole));
}

/** Fills a template's subject/body against one lead's variables. Never throws — an unknown token passes through literally. */
export function renderTemplate(
  template: RenderableTemplate,
  vars: Record<string, string>,
): { subject: string; bodyHtml: string; bodyText: string } {
  return {
    subject: fill(template.subject, vars),
    bodyHtml: fill(template.body_html, vars),
    bodyText: fill(template.body_text ?? "", vars),
  };
}

export function stepTypeLabel(type: DripStepType): string {
  switch (type) {
    case "email":
      return "Email";
    case "task":
      return "Internal task";
    case "wait":
      return "Wait";
    case "condition":
      return "Condition";
    default:
      return type;
  }
}

export const DRIP_STEP_TYPES: readonly DripStepType[] = ["email", "task", "wait", "condition"];

export function sequenceStatusLabel(active: boolean): string {
  return active ? "Active" : "Paused";
}

export function sequenceStatusTone(active: boolean): string {
  return active ? "lx-pill-ok" : "lx-pill-mute";
}

export function enrollmentStatusLabel(status: DripEnrollmentStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "paused":
      return "Paused";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function enrollmentStatusTone(status: DripEnrollmentStatus): string {
  switch (status) {
    case "active":
      return "lx-pill-ok";
    case "paused":
      return "lx-pill-warn";
    case "completed":
      return "lx-pill-mute";
    case "cancelled":
      return "lx-pill-risk";
    default:
      return "lx-pill-mute";
  }
}

/** Delay in hours as a short phrase ("Immediately", "4 hours", "3 days"). */
export function delayLabel(delayHours: number): string {
  if (!delayHours || delayHours <= 0) return "Immediately";
  if (delayHours % 24 === 0) {
    const days = delayHours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${delayHours} hour${delayHours === 1 ? "" : "s"}`;
}

/**
 * Whether `nextStepAt` is due (at or before `now`). Distinguished from
 * "no schedule at all" (a completed/cancelled enrollment, or one whose next
 * step has never been computed) — both return false, but only a caller that
 * also checks `nextStepAt !== null` should treat this as meaningful.
 */
export function isStepDue(nextStepAt: string | null, now: Date = new Date()): boolean {
  if (!nextStepAt) return false;
  const due = new Date(nextStepAt);
  if (Number.isNaN(due.getTime())) return false;
  return due.getTime() <= now.getTime();
}

/** ISO timestamp `delayHours` after `from`. */
export function addDelay(from: Date, delayHours: number): string {
  return new Date(from.getTime() + Math.max(0, delayHours) * 3600_000).toISOString();
}
