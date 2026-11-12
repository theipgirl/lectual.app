import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProposalContent } from "@/lib/proposals/types";
import type { ReviewedConsultRead } from "@/lib/consult/store";

/**
 * Sprint 3 F4: createProposalAction creates the draft in ONE step. A lead or matter id (or a blank start with a name)
 * becomes one `createProposal` call with content built by `buildDraftContent` and `made_by: "person"`, then a
 * redirect to the editor. The browser sends an id, never the client's details or any price.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";
const MATTER = "22222222-2222-4222-8222-222222222222";

class Redirected extends Error {
  constructor(public to: string) {
    super(to);
  }
}

const PACKAGES = [
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];
const LETTER = { id: "t-1", kind: "trademark" as const, version: 3, title: "Engagement letter", body: "Dear {{client_name}},\n\nThis letter confirms our engagement.\n\nFirm" };
const GENERAL_LETTER = { id: "t-2", kind: "general" as const, version: 1, title: "General letter", body: "Dear {{client_name}},\n\nThe work is described above.\n\nFirm" };
const lead = (over: Record<string, unknown> = {}) => ({ id: LEAD, first_name: "Ana", last_name: "Ruiz", business_name: "Acme Studio", email: "ana@example.com", mark_text: "Zephyr", ...over });
const matter = { id: MATTER, lead_id: LEAD, owner_name: "Ana Ruiz", mark_text: "Zephyr Wear", title: null, matter_number: "TM-1" };

type Opts = {
  gate?: { error: string } | "notFound" | null;
  lead?: Record<string, unknown> | null | "error";
  settings?: Record<string, unknown> | "throws";
  letters?: { trademark?: typeof LETTER | null; general?: typeof GENERAL_LETTER | null; status?: "ok" | "unavailable" | "not-set-up" };
  consult?: ReviewedConsultRead;
};

async function setup(opts: Opts = {}) {
  vi.resetModules();
  const created = vi.fn<(input: unknown) => Promise<{ id: string }>>(async () => ({ id: "new-1" }));
  const reads: string[] = [];
  const loadConsult = vi.fn(async () => opts.consult ?? ({ status: "ok", details: null, unreadable: false, unreviewed: false } as ReviewedConsultRead));
  let n = 0;
  vi.doMock("node:crypto", () => ({ randomBytes: () => ({ toString: () => String(++n).padStart(8, "0") }) }));
  vi.doMock("next/navigation", () => ({ redirect: vi.fn((to: string): never => { throw new Redirected(to); }) }));
  vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
  vi.doMock("@/app/dashboard/proposals/gate", () => ({
    gateStaffAction: vi.fn(async () => {
      reads.push("gate");
      if (opts.gate === "notFound") throw new Error("NEXT_NOT_FOUND");
      return opts.gate ?? null;
    }),
  }));
  vi.doMock("@/lib/proposals/store", () => ({
    createProposal: created,
    getProposalSettings: vi.fn(async () => {
      reads.push("settings");
      if (opts.settings === "throws") throw new Error("db down");
      return { default_pay_url: "https://pay.example/default", pricing: opts.settings ?? { packages: PACKAGES } };
    }),
  }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      from: (table: string) => {
        reads.push(`read:${table}`);
        const q = {
          select: () => q,
          eq: () => q,
          maybeSingle: async () => {
            if (table === "crm_matter") return { data: matter, error: null };
            if (opts.lead === "error") return { data: null, error: { message: "boom" } };
            return { data: opts.lead === undefined ? lead() : opts.lead, error: null };
          },
        };
        return q;
      },
    })),
  }));
  vi.doMock("@/lib/loe/templates-store", () => ({
    getApprovedLetter: vi.fn(async (_db: unknown, kind: "trademark" | "general") => {
      const status = opts.letters?.status ?? "ok";
      if (status !== "ok") return { status };
      return { status: "ok", letter: (kind === "general" ? opts.letters?.general : opts.letters?.trademark) ?? null };
    }),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/proposals/consult-prefill-load", () => ({ loadConsultForPrefill: loadConsult }));
  const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
  const run = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return createProposalAction({}, f);
  };
  return { created, reads, loadConsult, run };
}

type Created = { clientName: string; clientEmail: string | null; title?: string; content: ProposalContent; leadId: string | null; matterId: string | null; expiresOn: string | null; payUrl: string | null };
const call = (created: ReturnType<typeof vi.fn>) => created.mock.calls[0][0] as Created;

beforeEach(() => vi.resetModules());

describe("a lead id and nothing else", () => {
  it("creates one draft through one createProposal call, made_by person, and redirects to the editor", async () => {
    const { created, run } = await setup({ letters: { trademark: LETTER } });
    await expect(run({ leadId: LEAD })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    expect(created).toHaveBeenCalledTimes(1);
    const input = call(created);
    expect(input).toMatchObject({ clientName: "Ana Ruiz", clientEmail: "ana@example.com", leadId: LEAD, matterId: null, payUrl: null });
    expect(input.content.made_by).toBe("person");
    expect(input.content.client).toEqual({ first_name: "Ana", full_name: "Ana Ruiz", company: "Acme Studio" });
    expect(input.content.names.map((x) => x.name)).toEqual(["Zephyr"]);
    // The firm's packages and letter reach the draft; the browser sent neither.
    expect(input.content.pricing.package).toBe("Essential");
    expect(input.content.loe).toMatchObject({ template_id: "t-1", template_version: 3, kind: "trademark" });
    expect(input.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("the client's details are read on the server: a posted name, email or price is ignored", async () => {
    const { created, run } = await setup();
    await expect(run({ leadId: LEAD, fullName: "Mallory", clientEmail: "m@evil.example", base: "1", payUrl: "https://x.example/p", package: "Platinum" })).rejects.toBeInstanceOf(Redirected);
    const input = call(created);
    expect(input.clientName).toBe("Ana Ruiz");
    expect(input.clientEmail).toBe("ana@example.com");
    expect(input.payUrl).toBeNull();
    expect(JSON.stringify(input.content)).not.toContain("Mallory");
    expect(input.content.pricing.base_cents).toBe(195_000);
  });

  it("the firm's 'New proposals offer' is the starting point", async () => {
    const { created, run } = await setup({ settings: { packages: PACKAGES, new_offer: { mode: "choice", per: "brand", options: ["Essential", "Enhanced"], start: "Enhanced" } } });
    await expect(run({ leadId: LEAD })).rejects.toBeInstanceOf(Redirected);
    expect(call(created).content.names[0].package_choice).toEqual({ options: ["Essential", "Enhanced"], default: "Enhanced" });
  });

  it("a matter id links the matter and its own lead", async () => {
    const { created, run } = await setup();
    await expect(run({ matterId: MATTER })).rejects.toBeInstanceOf(Redirected);
    expect(call(created)).toMatchObject({ leadId: LEAD, matterId: MATTER, clientName: "Ana Ruiz" });
    expect(call(created).content.names.map((x) => x.name)).toEqual(["Zephyr Wear"]);
  });

  it("another firm's lead (the scoped read finds nothing) creates nothing", async () => {
    const { created, run } = await setup({ lead: null });
    expect(await run({ leadId: LEAD })).toEqual({ error: "That lead or matter couldn't be found." });
    expect(created).not.toHaveBeenCalled();
  });

  it("a record that can't be read says so and creates nothing; a malformed id reads nothing", async () => {
    const failing = await setup({ lead: "error" });
    expect(await failing.run({ leadId: LEAD })).toEqual({ error: "Couldn't read that record, so nothing was created. Try again shortly." });
    expect(failing.created).not.toHaveBeenCalled();
    const bad = await setup();
    expect(await bad.run({ leadId: "nope" })).toEqual({ error: "That lead isn't valid." });
    expect(await bad.run({ matterId: "nope" })).toEqual({ error: "That matter isn't valid." });
    expect(bad.reads.filter((r) => r.startsWith("read:"))).toEqual([]);
  });

  it("a failed settings read still creates the draft from the standard defaults", async () => {
    const { created, run } = await setup({ settings: "throws" });
    await expect(run({ leadId: LEAD })).rejects.toBeInstanceOf(Redirected);
    expect(call(created).content.pricing.package).toBe("Concierge");
  });
});

describe("Start blank", () => {
  it("a typed full name creates a draft with no brand and redirects to the editor", async () => {
    const { created, reads, run } = await setup({ letters: { trademark: LETTER } });
    await expect(run({ fullName: "Ana Ruiz", firstName: "Ana" })).rejects.toMatchObject({ to: "/dashboard/proposals/new-1/" });
    expect(created).toHaveBeenCalledTimes(1);
    expect(reads.filter((r) => r.startsWith("read:"))).toEqual([]);
    const input = call(created);
    expect(input).toMatchObject({ clientName: "Ana Ruiz", leadId: null, matterId: null });
    expect(input.content.made_by).toBe("person");
    expect(input.content.names).toEqual([]);
    expect(input.content.loe?.template_id).toBe("t-1");
  });

  it("no name creates nothing", async () => {
    const { created, run } = await setup();
    expect(await run({})).toEqual({ error: "Enter the client's full name." });
    expect(await run({ fullName: "  " })).toEqual({ error: "Enter the client's full name." });
    expect(created).not.toHaveBeenCalled();
  });

  it("a flat-fee start builds a general draft with the general letter only, no brand, no package list", async () => {
    const { created, run } = await setup({ letters: { trademark: LETTER, general: GENERAL_LETTER } });
    await expect(run({ fullName: "Faithe Williams", kind: "general" })).rejects.toBeInstanceOf(Redirected);
    const input = call(created);
    expect(input.title).toBe("Proposal");
    expect(input.content.kind).toBe("general");
    expect(input.content.made_by).toBe("person");
    expect(input.content.names).toEqual([]);
    expect(input.content.packages).toBeUndefined();
    expect(input.content.loe?.kind).toBe("general");
  });
});

describe("the letter read", () => {
  it("a firm with no letter table yet gets a draft with no letter", async () => {
    const { created, run } = await setup({ letters: { status: "not-set-up" } });
    await expect(run({ fullName: "Ana Ruiz" })).rejects.toBeInstanceOf(Redirected);
    expect("loe" in call(created).content).toBe(false);
  });

  it("a failed letter read creates nothing (a draft that silently lacks its letter would be mistaken for one that has it)", async () => {
    const { created, run } = await setup({ letters: { status: "unavailable" } });
    expect(await run({ fullName: "Ana Ruiz" })).toEqual({ error: "Couldn't read your engagement letter, so nothing was created. Try again shortly." });
    expect(created).not.toHaveBeenCalled();
  });
});

describe("the gate and the consult", () => {
  it("a refused role creates nothing and reads nothing", async () => {
    const { created, reads, run } = await setup({ gate: { error: "Your role can view proposals but not change them." } });
    expect(await run({ leadId: LEAD, useConsult: "on" })).toEqual({ error: "Your role can view proposals but not change them." });
    expect(reads).toEqual(["gate"]);
    expect(created).not.toHaveBeenCalled();
  });

  it("the module off is not-found before anything is read", async () => {
    const { created, reads, run } = await setup({ gate: "notFound" });
    await expect(run({ leadId: LEAD })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(reads).toEqual(["gate"]);
    expect(created).not.toHaveBeenCalled();
  });

  it("useConsult with a consult that is no longer reviewed creates nothing", async () => {
    const { created, run } = await setup({ consult: { status: "ok", details: null, unreadable: false, unreviewed: true } });
    expect(await run({ leadId: LEAD, useConsult: "on" })).toEqual({ error: "The consult details changed since this page loaded. Reload the page and try again." });
    expect(created).not.toHaveBeenCalled();
  });
});

describe("the second-stage form is gone", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));

  it("nothing in src imports NewProposalForm, NewGeneralProposalForm or applyNewProposalPackageFields", () => {
    for (const file of walk("src").filter((f) => /\.(ts|tsx)$/.test(f))) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/NewProposalForm|NewGeneralProposalForm|applyNewProposalPackageFields/);
    }
  });

  it("no page or component under proposals/new renders a brand name, package or pay-link field", () => {
    const files = [...walk("src/app/dashboard/proposals/new"), "src/components/proposal-editor/StartDraft.tsx", "src/components/proposal-editor/StartDoors.tsx"];
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/name="(brandName|package|payUrl|pkg[A-Za-z]*|discountPct|base|perClass)"/);
    }
  });

  it("the action sends, queues and approves nothing and imports no service role", () => {
    const src = readFileSync("src/app/dashboard/proposals/actions.ts", "utf8") + readFileSync("src/lib/proposals/draft-spec.ts", "utf8");
    expect(src).not.toMatch(/db\/admin|getAdminClient|sendMail|resolveQueueItem|approveProposal|sendProposal|queueDraft|createDraft\(/);
  });
});
