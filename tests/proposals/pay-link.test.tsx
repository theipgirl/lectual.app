import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NewProposalForm } from "@/components/proposal-editor/NewProposalForm";
import { DetailsForm } from "@/components/proposal-editor/Sections";
import { SettingsForm } from "@/components/proposal-editor/SettingsForm";
import { validateContent } from "@/lib/proposals/validate";
import { sevetri } from "./fixture";

/** Sprint 25 A: the pay link is a plain input on each proposal; nothing copies the firm default into one. */

vi.mock("@/app/dashboard/proposals/actions", () => ({ createProposalAction: vi.fn() }));
vi.mock("@/app/dashboard/settings/proposals/actions", () => ({ saveProposalSettingsAction: vi.fn() }));
vi.mock("@/components/proposal-editor/actions", () => ({ saveDetailsAction: vi.fn() }));

const DEFAULT_URL = "https://default.example/pay-me";
const inputOf = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0] ?? "";

describe("A1: the new-proposal form", () => {
  it("renders an empty pay-link input with the new label and placeholder", () => {
    const html = renderToStaticMarkup(
      createElement(NewProposalForm, {
        defaults: { leadId: "", matterId: "", fullName: "", firstName: "", company: "", clientEmail: "", brandName: "", title: "T", expiresOn: "2026-11-10", payUrl: "" },
        hasSettings: true,
        packages: null,
      }),
    );
    const input = inputOf(html, "payUrl");
    expect(input).toContain('placeholder="Enter custom pay link"');
    expect(input).toContain('value=""');
    expect(html).toContain(">Pay link<");
    expect(html).not.toContain("Pay link (https)");
    expect(html).not.toContain(DEFAULT_URL);
  });
});

describe("A2: createProposalAction does not copy the firm default", () => {
  beforeEach(() => vi.resetModules());
  class Redirected extends Error {}
  async function setup() {
    const inserted: unknown[] = [];
    const created = vi.fn(async (input: { payUrl: string | null }) => {
      const { checkDraftColumns } = await vi.importActual<typeof import("@/lib/proposals/store")>("@/lib/proposals/store");
      checkDraftColumns({ payUrl: input.payUrl });
      inserted.push(input);
      return { id: "new-1" };
    });
    vi.doUnmock("@/app/dashboard/proposals/actions");
    vi.doMock("next/navigation", () => ({ redirect: vi.fn((): never => { throw new Redirected(); }) }));
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateStaffAction: vi.fn(async () => null) }));
    vi.doMock("@/lib/proposals/store", () => ({
      createProposal: created,
      getProposalSettings: vi.fn(async () => ({ default_pay_url: DEFAULT_URL, pricing: {} })),
    }));
    const { createProposalAction } = await import("../../src/app/dashboard/proposals/actions");
    const run = (extra: Record<string, string>) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ fullName: "Ana Ruiz", firstName: "Ana", expiresOn: "2026-11-10", ...extra })) f.set(k, v);
      return createProposalAction({}, f);
    };
    return { created, inserted, run };
  }

  it("a blank pay link stays null", async () => {
    const { created, run } = await setup();
    await expect(run({ payUrl: "" })).rejects.toBeInstanceOf(Redirected);
    expect(created.mock.calls[0][0].payUrl).toBeNull();
  });

  it("a typed https link is stored", async () => {
    const { created, run } = await setup();
    await expect(run({ payUrl: "https://pay.example/ana" })).rejects.toBeInstanceOf(Redirected);
    expect(created.mock.calls[0][0].payUrl).toBe("https://pay.example/ana");
  });

  it("an http link is refused with the real check and nothing is created", async () => {
    const { created, inserted, run } = await setup();
    const r = await run({ payUrl: "http://insecure.example/pay" });
    expect(r).toMatchObject({ error: "The pay link must be an https:// address." });
    expect(created).toHaveBeenCalledTimes(1);
    expect(inserted).toEqual([]);
  });
});

describe("A3: the existing-proposal editor", () => {
  const render = (payUrl: string) =>
    renderToStaticMarkup(
      createElement(DetailsForm, {
        proposalId: "p",
        updatedAt: "2026-10-22T00:00:00Z",
        editable: true,
        issues: [],
        values: { fullName: "A", firstName: "A", company: "", clientEmail: "", title: "T", expiresOn: "2026-11-10", payUrl },
      }),
    );
  it("shows the proposal's own link, or an empty input with the placeholder", () => {
    expect(inputOf(render(""), "payUrl")).toContain('placeholder="Enter custom pay link"');
    expect(inputOf(render(""), "payUrl")).toContain('value=""');
    expect(inputOf(render("https://pay.example/x"), "payUrl")).toContain('value="https://pay.example/x"');
    expect(render("")).toContain(">Pay link<");
  });
});

describe("A4: approval still refuses a missing link", () => {
  it("says to add the pay link", () => {
    const issues = validateContent(sevetri(), { forApproval: true, pay_url: null });
    expect(issues.some((i) => i.path === "pay_url" && i.message === "Add the pay link before approving.")).toBe(true);
  });
});

describe("A7: settings", () => {
  it("has no Default pay link field", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsForm, { members: [], values: { approverUserIds: [], notifyEmail: "", officeActionNote: "", includes: [] } }),
    );
    expect(inputOf(html, "defaultPayUrl")).toBe("");
    expect(html).not.toContain("Default pay link");
  });

  it("saving settings keeps a stored default_pay_url", async () => {
    vi.resetModules();
    vi.doUnmock("@/app/dashboard/settings/proposals/actions");
    const saved = vi.fn(async (i: unknown) => i);
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/app/dashboard/proposals/gate", () => ({ gateAdminAction: vi.fn(async () => null) }));
    vi.doMock("@/lib/members/directory", () => ({ listMemberDirectory: vi.fn(async () => []) }));
    vi.doMock("@/lib/proposals/store", () => ({
      getProposalSettings: vi.fn(async () => ({ default_pay_url: DEFAULT_URL, notify_email: null, approver_user_ids: [], pricing: {} })),
      saveProposalSettings: saved,
    }));
    const { saveProposalSettingsAction } = await import("../../src/app/dashboard/settings/proposals/actions");
    const f = new FormData();
    f.set("defaultPayUrl", "https://evil.example/");
    const r = await saveProposalSettingsAction({}, f);
    expect(r.error).toBeUndefined();
    expect((saved.mock.calls[0][0] as { defaultPayUrl: string | null }).defaultPayUrl).toBe(DEFAULT_URL);
  });
});

describe("A5/A6: no code path reads the default for behaviour", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(n)) out.push(p);
    }
    return out;
  }
  it("only the column plumbing and the settings pass-through mention it", () => {
    const allowed = [
      "src/lib/db/types.ts",
      "src/lib/proposals/store.ts",
      "src/lib/proposals/types.ts",
      "src/lib/proposals/validate.ts",
      "src/app/dashboard/settings/proposals/actions.ts",
      "src/app/dashboard/settings/integrations/lawmatics/loe-fields-actions.ts",
    ];
    const hits = walk("src").filter((f) => /default_pay_url|defaultPayUrl/.test(readFileSync(f, "utf8")) && !allowed.includes(f));
    expect(hits).toEqual([]);
  });

  it("a new version keeps the proposal's own pay_url and a prefill carries no link", () => {
    const store = readFileSync("src/lib/proposals/store.ts", "utf8");
    expect(store).toMatch(/pay_url: (source|prev|current|row|base)\w*\.pay_url/);
    expect(readFileSync("src/lib/proposals/prefill.ts", "utf8")).not.toMatch(/pay_?url/i);
  });

  it("the drafter's flag never mentions a default", () => {
    const draft = readFileSync("src/lib/consult-proposal/draft.ts", "utf8");
    expect(draft).toContain("Add the client's pay link before approving.");
    expect(draft).not.toMatch(/default pay link/i);
  });
});
