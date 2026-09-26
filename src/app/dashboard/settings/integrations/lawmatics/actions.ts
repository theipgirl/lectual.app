"use server";

// Ported from lectual src/app/(firm)/dashboard/import/actions.ts. The preview →
// confirm flow, the fingerprint check and the view models are unchanged.
// Changed: the gate. lectual needs the `lawmatics-import` module because its
// token is one deployment-wide credential; here every call uses the calling
// firm's OWN token (src/lib/lawmatics/connection.ts), so the gate is the role
// alone. Added: connect/disconnect, and a 401 marks the connection invalid.

import { revalidatePath } from "next/cache";

import { ROLES, hasRole, type Role } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { LawmaticsApiError } from "@/lib/lawmatics/client";
import {
  LawmaticsNotConnectedError,
  checkTokenShape,
  disconnectLawmatics,
  recordLawmaticsOutcome,
  saveLawmaticsToken,
  verifyLawmaticsToken,
} from "@/lib/lawmatics/connection";
import {
  PlanChangedError,
  applyImport,
  describe,
  previewImport,
  type ImportReport,
  type PreviewResult,
} from "@/lib/lawmatics/import";
import type {
  PlanOptions,
  PlannedCreate,
  PlannedUpdate,
  SkippedRecord,
  StageDivergence,
  WithheldFields,
  UnmappedRecord,
} from "@/lib/lawmatics/import-plan";
import {
  MattersPlanChangedError,
  applyMattersImport,
  previewMattersImport,
  type MattersImportReport,
  type MattersPreviewResult,
} from "@/lib/lawmatics/matters-import";
import type {
  PlannedMatterUpdate,
  SkippedMatterRecord,
  UnmappedMatterRecord,
} from "@/lib/lawmatics/matters-import-plan";

const PAGE = "/dashboard/settings/integrations/lawmatics/";

/** owner / admin / senior_admin. Re-checked on every call: a POST is its own entry point. */
const REQUIRED_ROLE: Role = "senior_admin";

async function requireImportAdmin(): Promise<void> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.rpc("current_org_role");
  if (error) throw new Error("Forbidden: could not resolve your role for this firm.");
  const role: Role | null =
    typeof data === "string" && (ROLES as readonly string[]).includes(data) ? (data as Role) : null;
  if (!role || !hasRole(role, REQUIRED_ROLE)) {
    throw new Error("Forbidden: importing client records requires an owner or admin role.");
  }
}

/** Human text for a failed run, and a rejected token marks the connection invalid. */
async function failure(err: unknown): Promise<string> {
  if (err instanceof LawmaticsNotConnectedError) return err.message;
  if (err instanceof LawmaticsApiError && (err.status === 401 || err.status === 403)) {
    await recordLawmaticsOutcome({ rejected: true, error: "Lawmatics rejected the token." });
    return "Lawmatics rejected your firm's token. Reconnect it above.";
  }
  // A database error (anything carrying a `code`) never reaches the screen verbatim.
  const coded = typeof (err as { code?: unknown } | null)?.code === "string";
  const text = coded ? "The import couldn't write to your records. Nothing was left half-done; try again shortly." : describe(err);
  await recordLawmaticsOutcome({ error: text });
  return text;
}

// ── Connect / disconnect ─────────────────────────────────────────────────────

export type ConnectState = { ok?: boolean; error?: string };

export async function connectLawmaticsAction(_prev: ConnectState, formData: FormData): Promise<ConnectState> {
  try {
    await requireImportAdmin();
  } catch {
    return { error: "Only owners and admins can connect Lawmatics." };
  }
  const root = rootKeyOrNull();
  if (!root) return { error: "Integrations aren't set up on this deployment yet (no encryption key)." };
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return { error: "Sign in again to connect Lawmatics." };

  const shape = checkTokenShape(String(formData.get("token") ?? ""));
  if (!shape.ok) return { error: shape.reason };
  const verified = await verifyLawmaticsToken(shape.token);
  if (!verified.ok) return { error: verified.reason };

  // org and user come from the session, never the form.
  const saved = await saveLawmaticsToken({ root, orgId: session.org.id, userId: session.user.id, token: shape.token });
  if (!saved.ok) return { error: saved.reason };
  revalidatePath(PAGE);
  revalidatePath("/dashboard/settings/integrations/");
  return { ok: true };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function disconnectLawmaticsAction(_prev: ConnectState, _formData: FormData): Promise<ConnectState> {
  try {
    await requireImportAdmin();
  } catch {
    return { error: "Only owners and admins can disconnect Lawmatics." };
  }
  const result = await disconnectLawmatics();
  if (!result.ok) return { error: result.reason };
  revalidatePath(PAGE);
  revalidatePath("/dashboard/settings/integrations/");
  return { ok: true };
}

// ── View models ──────────────────────────────────────────────────────────────
// The full plan can run to thousands of rows. The browser gets a capped copy
// for display only — the counts stay exact, and the write path never reads
// any of this back.

const LIST_CAP = 150;

export type PreviewView = {
  fetchedAt: string;
  fingerprint: string;
  options: PlanOptions;
  counts: { prospects: number; contacts: number };
  totals: {
    sourceRecords: number;
    create: number;
    update: number;
    unchanged: number;
    divergent: number;
    withheld: number;
    unmapped: number;
    skipped: number;
  };
  truncated: boolean;
  truncatedReason?: string;
  includeDropped: boolean;
  includeDroppedReason?: string;
  stageNames: string[];
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  divergences: StageDivergence[];
  withheld: WithheldFields[];
  unmapped: UnmappedRecord[];
  skipped: SkippedRecord[];
  omitted: {
    creates: number;
    updates: number;
    divergences: number;
    withheld: number;
    unmapped: number;
    skipped: number;
  };
};

export type ReportView = ImportReport & {
  omitted: { divergences: number; unmapped: number; skipped: number };
};

export type ImportState = {
  phase: "idle" | "preview" | "done" | "error";
  preview?: PreviewView;
  report?: ReportView;
  error?: string;
  notice?: string;
};

// NOTE: a "use server" module may only export async functions, so the initial
// state constant lives in the client component, not here.

function toPreviewView(preview: PreviewResult): PreviewView {
  const p = preview.plan;
  return {
    fetchedAt: preview.fetchedAt,
    fingerprint: p.fingerprint,
    options: p.options,
    counts: preview.counts,
    totals: p.totals,
    truncated: preview.truncated,
    truncatedReason: preview.truncatedReason,
    includeDropped: preview.includeDropped,
    includeDroppedReason: preview.includeDroppedReason,
    stageNames: preview.stageNames,
    creates: p.creates.slice(0, LIST_CAP),
    updates: p.updates.slice(0, LIST_CAP),
    divergences: p.divergences.slice(0, LIST_CAP),
    withheld: p.withheld.slice(0, LIST_CAP),
    unmapped: p.unmapped.slice(0, LIST_CAP),
    skipped: p.skipped.slice(0, LIST_CAP),
    omitted: {
      creates: Math.max(0, p.creates.length - LIST_CAP),
      updates: Math.max(0, p.updates.length - LIST_CAP),
      divergences: Math.max(0, p.divergences.length - LIST_CAP),
      withheld: Math.max(0, p.withheld.length - LIST_CAP),
      unmapped: Math.max(0, p.unmapped.length - LIST_CAP),
      skipped: Math.max(0, p.skipped.length - LIST_CAP),
    },
  };
}

function toReportView(report: ImportReport): ReportView {
  return {
    ...report,
    divergences: report.divergences.slice(0, LIST_CAP),
    unmapped: report.unmapped.slice(0, LIST_CAP),
    skipped: report.skipped.slice(0, LIST_CAP),
    failures: report.failures.slice(0, LIST_CAP),
    omitted: {
      divergences: Math.max(0, report.divergences.length - LIST_CAP),
      unmapped: Math.max(0, report.unmapped.length - LIST_CAP),
      skipped: Math.max(0, report.skipped.length - LIST_CAP),
    },
  };
}

function readOptions(formData: FormData): PlanOptions {
  // Checkbox posts "on" when ticked, or is entirely absent from the FormData
  // when unticked — there is no "off" value to read. "Trademark intake only"
  // is checked by default (blueprint §6/§7), so its filter text is derived
  // from the checkbox rather than from a separate always-present field: an
  // operator who unticks it gets every practice area, exactly like the two
  // existing checkboxes' off state.
  return {
    moveExistingStages: formData.get("moveExistingStages") === "on",
    overwriteEditedFields: formData.get("overwriteEditedFields") === "on",
    practiceAreaFilter: formData.get("trademarkOnly") === "on" ? "Trademark" : null,
  };
}

// ── The action ───────────────────────────────────────────────────────────────

/**
 * Single entry point for both steps; `intent` decides which. Anything other
 * than an explicit `confirm` with a matching fingerprint and a ticked
 * acknowledgement is a dry run.
 */
export async function importAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const intent = String(formData.get("intent") ?? "preview");
  const options = readOptions(formData);

  try {
    await requireImportAdmin();
  } catch (err) {
    return { phase: "error", error: describe(err) };
  }

  if (intent === "confirm") {
    const fingerprint = String(formData.get("fingerprint") ?? "").trim();
    const acknowledged = formData.get("acknowledge") === "on";

    if (!fingerprint) {
      return { phase: "error", error: "Run a preview first — there's nothing approved to import." };
    }
    if (!acknowledged) {
      // Second explicit confirmation. Without it, fall back to showing the plan.
      try {
        return {
          phase: "preview",
          preview: toPreviewView(await previewImport(options)),
          error: "Tick the confirmation box to write these records.",
        };
      } catch (err) {
        return { phase: "error", error: await failure(err) };
      }
    }

    try {
      const report = await applyImport(fingerprint, options);
      // The pipeline and lead surfaces now have new rows behind them.
      await recordLawmaticsOutcome({ imported: true });
      revalidatePath("/dashboard/leads/");
      revalidatePath(PAGE);
      return {
        phase: "done",
        report: toReportView(report),
        notice:
          report.failures.length > 0
            ? "Import finished with some failures — see below."
            : "Import finished.",
      };
    } catch (err) {
      if (err instanceof PlanChangedError) {
        return {
          phase: "preview",
          preview: toPreviewView(err.preview),
          error: err.message,
        };
      }
      return { phase: "error", error: await failure(err) };
    }
  }

  // Default: dry run. Reads Lawmatics and the pipeline, writes nothing.
  try {
    return { phase: "preview", preview: toPreviewView(await previewImport(options)) };
  } catch (err) {
    return { phase: "error", error: await failure(err) };
  }
}

// ── Matters (update-existing-only) importer ─────────────────────────────────
// Same two-step preview/confirm shape as the lead importer above, but as two
// separately-named exported actions rather than one `intent`-branching
// action — the task calls for two distinct entry points, and this importer
// has no options to carry between them (every write is null-only-guarded by
// construction, so there is nothing equivalent to moveExistingStages /
// overwriteEditedFields to thread through a hidden field).

export type MattersPreviewView = {
  fetchedAt: string;
  fingerprint: string;
  counts: { prospects: number };
  totals: MattersPreviewResult["plan"]["totals"];
  truncated: boolean;
  truncatedReason?: string;
  updates: PlannedMatterUpdate[];
  unmapped: UnmappedMatterRecord[];
  skipped: SkippedMatterRecord[];
  omitted: { updates: number; unmapped: number; skipped: number };
};

export type MattersReportView = MattersImportReport & {
  omitted: { unmapped: number; skipped: number };
};

export type MattersImportState = {
  phase: "idle" | "preview" | "done" | "error";
  preview?: MattersPreviewView;
  report?: MattersReportView;
  error?: string;
  notice?: string;
};

function toMattersPreviewView(preview: MattersPreviewResult): MattersPreviewView {
  const p = preview.plan;
  return {
    fetchedAt: preview.fetchedAt,
    fingerprint: p.fingerprint,
    counts: preview.counts,
    totals: p.totals,
    truncated: preview.truncated,
    truncatedReason: preview.truncatedReason,
    updates: p.updates.slice(0, LIST_CAP),
    unmapped: p.unmapped.slice(0, LIST_CAP),
    skipped: p.skipped.slice(0, LIST_CAP),
    omitted: {
      updates: Math.max(0, p.updates.length - LIST_CAP),
      unmapped: Math.max(0, p.unmapped.length - LIST_CAP),
      skipped: Math.max(0, p.skipped.length - LIST_CAP),
    },
  };
}

function toMattersReportView(report: MattersImportReport): MattersReportView {
  return {
    ...report,
    unmapped: report.unmapped.slice(0, LIST_CAP),
    skipped: report.skipped.slice(0, LIST_CAP),
    failures: report.failures.slice(0, LIST_CAP),
    omitted: {
      unmapped: Math.max(0, report.unmapped.length - LIST_CAP),
      skipped: Math.max(0, report.skipped.length - LIST_CAP),
    },
  };
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function previewMattersImportAction(
  _prev: MattersImportState,
  _formData: FormData,
)
/* eslint-enable @typescript-eslint/no-unused-vars */: Promise<MattersImportState> {
  try {
    await requireImportAdmin();
  } catch (err) {
    return { phase: "error", error: describe(err) };
  }

  try {
    return { phase: "preview", preview: toMattersPreviewView(await previewMattersImport()) };
  } catch (err) {
    return { phase: "error", error: await failure(err) };
  }
}

export async function applyMattersImportAction(
  _prev: MattersImportState,
  formData: FormData,
): Promise<MattersImportState> {
  try {
    await requireImportAdmin();
  } catch (err) {
    return { phase: "error", error: describe(err) };
  }

  const fingerprint = String(formData.get("fingerprint") ?? "").trim();
  const acknowledged = formData.get("acknowledge") === "on";

  if (!fingerprint) {
    return { phase: "error", error: "Run a preview first — there's nothing approved to import." };
  }
  if (!acknowledged) {
    // Second explicit confirmation. Without it, fall back to showing the plan.
    try {
      return {
        phase: "preview",
        preview: toMattersPreviewView(await previewMattersImport()),
        error: "Tick the confirmation box to write these updates.",
      };
    } catch (err) {
      return { phase: "error", error: await failure(err) };
    }
  }

  try {
    const report = await applyMattersImport(fingerprint);
    await recordLawmaticsOutcome({ imported: true });
    revalidatePath("/dashboard/matters/");
    revalidatePath(PAGE);
    return {
      phase: "done",
      report: toMattersReportView(report),
      notice:
        report.failures.length > 0
          ? "Import finished with some failures — see below."
          : "Import finished.",
    };
  } catch (err) {
    if (err instanceof MattersPlanChangedError) {
      return {
        phase: "preview",
        preview: toMattersPreviewView(err.preview),
        error: err.message,
      };
    }
    return { phase: "error", error: await failure(err) };
  }
}
