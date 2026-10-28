import "server-only";
import { randomBytes } from "node:crypto";
import type { Lead } from "@/lib/pipeline";
import type { Role } from "@/lib/auth/roles";
import { PROPOSAL_STAFF_WRITE_ROLES, type ProposalContent } from "@/lib/proposals/types";
import {
  askedForProposal,
  buildDraft,
  confirmsDraft,
  draftRef,
  isConfirmation,
  parseDraftRequest,
  type BuiltDraft,
  type ConfirmationContext,
  type DraftLead,
} from "@/lib/copilot/draft-proposal";

/**
 * The executor of Copilot's one write tool, `draft_proposal` (rules and the
 * confirmation design: `@/lib/copilot/draft-proposal`).
 *
 * It creates a DRAFT `client_proposal` and nothing else: no approval, no client
 * link, no send, no queued email. Every read and the one write go through the
 * caller's own scoped client (`getLead` / `listLeads`, `getProposalSettings`,
 * `createProposal` with `source: 'agent'`), so RLS and 0089's policies and
 * trigger are the boundary; `createProposal` re-checks the proposal-writing
 * role itself. The gate below is checked on every call, before any read:
 * the `proposals` module on AND a proposal-writing role, both read fresh, and
 * anything unreadable counts as no (fail closed). Module off and role refused
 * give the same sentence, so the answer says nothing about which firms hold
 * the module.
 */

export type DraftProposalDeps = {
  /** True only when the caller's firm holds `proposals` and the caller's role may write proposals. Must not throw for "no". */
  mayDraft: () => Promise<boolean>;
  getLead: (id: string) => Promise<Lead | null>;
  searchLeads: (term: string) => Promise<Lead[]>;
  /** `client_proposal_setting.pricing`, `{}` when none is saved. Throws when the read fails. */
  readPricing: () => Promise<unknown>;
  create: (input: {
    clientName: string;
    clientEmail: string | null;
    content: ProposalContent;
    leadId: string;
    payUrl: string | null;
  }) => Promise<{ id: string }>;
};

/** What one question's run remembers: the last draft shown for confirmation, and whether one was created. */
export type DraftSink = {
  pending: { summary: string; ref: string } | null;
  created: { id: string; clientName: string } | null;
};

export const newDraftSink = (): DraftSink => ({ pending: null, created: null });

export const NOT_AVAILABLE = "Drafting a proposal isn't available for you here.";
export const NOT_ASKED = "No proposal was asked for in this conversation, so nothing was prepared. Draft one only when the user asks for a proposal.";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const leadName = (l: Pick<Lead, "first_name" | "last_name" | "business_name">) =>
  `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.business_name?.trim() || "Lead";

function asDraftLead(l: Lead): DraftLead {
  return { id: l.id, first_name: l.first_name, last_name: l.last_name, business_name: l.business_name, email: l.email, mark_text: l.mark_text ?? null };
}

export async function defaultDraftProposalDeps(): Promise<DraftProposalDeps> {
  const [{ orgHasModule }, { currentRole }, pipeline, store] = await Promise.all([
    import("@/lib/org/modules"),
    import("@/lib/auth/current-role"),
    import("@/lib/pipeline"),
    import("@/lib/proposals/store"),
  ]);
  return {
    mayDraft: async () => {
      try {
        if (!(await orgHasModule("proposals"))) return false;
        const role: Role | null = await currentRole();
        return role !== null && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
      } catch {
        return false;
      }
    },
    getLead: (id) => pipeline.getLead(id),
    searchLeads: (term) => pipeline.listLeads({ search: term }),
    readPricing: async () => (await store.getProposalSettings())?.pricing ?? {},
    create: async (input) => {
      const row = await store.createProposal({ ...input, source: "agent" });
      return { id: row.id };
    },
  };
}

export const proposalHref = (id: string) => `/dashboard/proposals/${id}/`;

/**
 * Runs one `draft_proposal` call. `confirm` is null when the server has no
 * thread to judge (the one-shot answer): then nothing is ever created.
 * `citeLead` / `citeProposal` put records on the answer's citations.
 */
export async function runDraftProposal(
  rawInput: unknown,
  ctx: {
    confirm: ConfirmationContext | null;
    sink: DraftSink;
    deps: () => Promise<DraftProposalDeps>;
    leadSearchTerm: (q: string) => string;
    citeLead: (l: Lead) => void;
    citeProposal: (id: string, label: string) => void;
  },
): Promise<Record<string, unknown>> {
  if (!ctx.confirm || !askedForProposal(ctx.confirm.userTurns)) return { status: "not_asked", message: NOT_ASKED };

  const deps = await ctx.deps();
  if (!(await deps.mayDraft())) return { status: "not_available", message: NOT_AVAILABLE };

  const parsed = parseDraftRequest(rawInput);
  if (!parsed.ok) return { status: "needs_input", ask: parsed.ask, message: "Nothing was created. Ask the user this." };
  const request = parsed.value;

  // The lead: an id is re-read (another firm's reads as missing); a name must match exactly one lead.
  let lead: Lead | null;
  try {
    if (UUID.test(request.lead)) lead = await deps.getLead(request.lead);
    else {
      const matches = await deps.searchLeads(ctx.leadSearchTerm(request.lead));
      if (matches.length > 1) {
        const shown = matches.slice(0, 8);
        shown.forEach(ctx.citeLead);
        return {
          status: "lead_ambiguous",
          message: "More than one lead matches. Nothing was created. Ask the user which one they mean; never pick one yourself.",
          candidates: shown.map((l) => ({ id: l.id, name: leadName(l), businessName: l.business_name, email: l.email })),
          truncated: matches.length > shown.length,
        };
      }
      lead = matches[0] ?? null;
    }
  } catch {
    return { status: "unavailable", message: "The firm's leads couldn't be read right now, so nothing was created." };
  }
  if (!lead) return { status: "lead_not_found", message: "No lead matches that. Nothing was created. Ask the user which lead the proposal is for." };
  ctx.citeLead(lead);

  let pricing: unknown;
  try {
    pricing = await deps.readPricing();
  } catch {
    return { status: "unavailable", message: "The firm's packages couldn't be read, so nothing was created." };
  }

  const built = buildDraft(request, asDraftLead(lead), pricing, () => randomBytes(4).toString("hex"));
  if (!built.ok) {
    if (built.kind === "package_not_found") {
      return { status: "package_not_found", message: "That package isn't on the firm's list. Nothing was created. Ask the user which of these to use.", packages: built.packages };
    }
    return { status: "needs_input", ask: "This lead has no name on record. Add the client's name to the lead first.", message: "Nothing was created." };
  }
  const draft: BuiltDraft = built.draft;
  if (draft.blocking.length > 0) {
    return { status: "needs_changes", message: "Nothing was created. Ask the user to change these, in plain words:", problems: draft.blocking };
  }

  const ref = draftRef(ctx.confirm.orgId, draft, request);
  const confirmed =
    request.confirmed && !ctx.sink.created && isConfirmation(ctx.confirm.question) && confirmsDraft(ctx.confirm.previousAnswer, ref);

  if (!confirmed) {
    ctx.sink.pending = { summary: draft.summary, ref };
    return {
      status: "ready_to_confirm",
      message:
        "Nothing has been created. Say in one short sentence that the draft is ready to check. The app adds the exact summary and asks 'Create this draft?' itself. Create it only when the user's NEXT message confirms, by calling this tool again with the same details and confirmed: true.",
      leadId: lead.id,
      summary: draft.summary,
      issuesToFixInEditor: draft.issues,
      ...(request.confirmed ? { why: "The user's current message isn't a plain yes to this exact draft, so it was shown again instead." } : {}),
    };
  }

  try {
    const created = await deps.create({ clientName: draft.clientName, clientEmail: draft.clientEmail, content: draft.content, leadId: lead.id, payUrl: draft.payLink });
    ctx.sink.created = { id: created.id, clientName: draft.clientName };
    ctx.sink.pending = null;
    ctx.citeProposal(created.id, `Draft proposal — ${draft.clientName}`);
    return {
      status: "created",
      message: "A DRAFT was created. Nothing was approved, no client link was made and nothing was sent. Staff review and edit it in the proposal editor.",
      proposalId: created.id,
      link: proposalHref(created.id),
      issuesToFixInEditor: draft.issues,
    };
  } catch {
    return { status: "failed", message: "The draft couldn't be created, so nothing was saved. Suggest trying again or using New proposal." };
  }
}
