import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LetterPageModel, LetterVersion } from "@/lib/loe/page-model";

/**
 * The Engagement letter settings page, rendered statically with its data layer mocked. Seven states, each
 * asserting visible text. Set SHOT_DIR to also write full HTML documents (repo CSS inlined) for screenshots.
 */

const load = vi.fn<() => Promise<LetterPageModel>>();
const gate = vi.fn(async () => undefined);
const session = vi.fn<() => Promise<{ kind: "ok"; org: { slug: string | null } } | { kind: "none" }>>(async () => ({ kind: "ok", org: { slug: "hartwell-ip" } }));

vi.mock("@/lib/loe/page-load", () => ({ loadLetterPage: () => load() }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: () => session() }));
vi.mock("@/app/dashboard/proposals/gate", () => ({ requireProposalsModule: () => gate() }));
vi.mock("@/app/dashboard/settings/proposals/engagement-letter/actions", () => ({
  startDraftAction: vi.fn(),
  startFromVersionAction: vi.fn(),
  saveDraftAction: vi.fn(),
  approveLetterAction: vi.fn(),
}));

const BODY =
  "**Scope of work.** We will prepare and file the trademark application for {{entity_name}}.\n\nDear {{client_name}},\n\nThis letter is dated {{date}} and confirms the work described above.\n\n{{address_block}}\n\nSigned by {{signer_name}} on {{signed_date}}.";

const version = (over: Partial<LetterVersion>): LetterVersion => ({
  id: "33333333-3333-4333-8333-333333333333",
  kind: "trademark",
  version: 1,
  status: "draft",
  title: "Engagement letter",
  body: BODY,
  updatedAt: "2026-11-12T15:00:00Z",
  approvedAt: null,
  ...over,
});

const ok = (over: Partial<Extract<LetterPageModel, { status: "ok" }>> = {}): LetterPageModel => ({
  status: "ok",
  canEdit: true,
  canApprove: true,
  approvers: { status: "ok", names: ["Rebecca Ortiz"] },
  versions: [],
  ...over,
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

async function render(model: LetterPageModel, name?: string): Promise<string> {
  load.mockResolvedValue(model);
  vi.resetModules();
  const { default: Page } = await import("@/app/dashboard/settings/proposals/engagement-letter/page");
  const html = renderToStaticMarkup(await Page());
  if (name && process.env.SHOT_DIR) writeShot(name, html);
  return html;
}

function writeShot(name: string, body: string) {
  const root = process.cwd();
  let g = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8").replace('@import "tailwindcss";', "");
  g = g.replace(/@theme inline \{[\s\S]*?\n\}\n/, "");
  const css = [g, fs.readFileSync(path.join(root, "src/app/dashboard/proposals/proposals.css"), "utf8"), fs.readFileSync(path.join(root, "src/components/loe/loe.css"), "utf8")].join("\n");
  const reset = "html,body{height:auto!important}.lx-content{overflow:visible!important;display:block!important;padding-left:26px;padding-right:26px}.lx-page{overflow:visible!important}@media(max-width:640px){.lx-content{padding-left:12px;padding-right:12px}}*,*::before,*::after{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}h1,h2,h3,p,ul,ol,dl{margin:0}";
  const doc = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>${reset}\n${css}</style></head><body><div class="lx-content"><div class="lx-page">${body}</div></div></body></html>`;
  fs.mkdirSync(process.env.SHOT_DIR!, { recursive: true });
  fs.writeFileSync(path.join(process.env.SHOT_DIR!, `${name}.html`), doc);
}

beforeEach(() => {
  load.mockReset();
  gate.mockClear();
  session.mockClear();
});

describe("Engagement letter settings: seven states", () => {
  it("1. no template yet: the empty state and Start a draft (never an editor)", async () => {
    const html = await render(ok());
    const t = text(html);
    expect(t).toContain("Engagement letter");
    expect(t).toContain("No letter yet. Start a draft");
    expect(t).toContain("Trademark letter");
    expect(t).toContain("Flat-fee letter");
    expect(html.match(/Start a draft<\/button>/g)).toHaveLength(2);
    expect(html).toContain('name="kind" value="trademark"');
    expect(html).toContain('name="kind" value="general"');
    expect(t).toContain("Merge fields you can use");
    for (const f of ["date", "client_name", "entity_name", "address_block", "client_email", "signer_name", "signed_date"]) expect(html).toContain(`{{${f}}}`);
    expect(t).not.toContain("Approve");
    expect(gate).toHaveBeenCalled();
  });

  it("2. a draft: editable title and text, Save draft, Preview, and Approve for a named approver", async () => {
    const html = await render(ok({ versions: [version({})] }), "draft");
    const t = text(html);
    expect(html).toContain("<textarea");
    expect(html).toContain("Dear {{client_name}}");
    expect(t).toContain("Save draft");
    expect(t).toContain("Preview with sample values");
    expect(t).toContain("Alex Sample");
    expect(t).toContain("Sample Goods LLC");
    expect(t).toContain("Draft");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Approve<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
    expect(t).toContain("Can approve: Rebecca Ortiz.");
    // The preview shows paragraphs as separate blocks, with the bold lead-in, and no raw braces.
    const preview = html.slice(html.indexOf('data-testid="letter-preview"'));
    expect(preview.match(/<p>/g)!.length).toBeGreaterThanOrEqual(5);
    expect(preview).toContain("<strong>Scope of work.</strong>");
    expect(text(preview.slice(0, preview.indexOf("</section>")))).not.toMatch(/\{\{|\}\}/);
    expect(t).not.toMatch(/lorem|TODO/i);
  });

  it("2b. a draft with an unknown merge field shows the problem inline and disables Approve", async () => {
    const html = await render(ok({ versions: [version({ body: "Dear {{clinet_name}}, hello." })] }));
    const t = text(html);
    expect(t).toContain("{{clinet_name}} is not a merge field");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Approve<\/button>/);
    expect(t).toContain("Fix the problems above before approving.");
    // The preview refuses to show a half-filled letter.
    expect(html).not.toContain('data-testid="letter-preview"');
    expect(t).toContain("The letter uses {{clinet_name}}, which is not a merge field.");
  });

  it("3. an approved version: read-only text and Start a new draft from this version", async () => {
    const html = await render(
      ok({
        versions: [
          version({ status: "approved", approvedAt: "2026-11-12T16:00:00Z" }),
          version({ id: "d4444444-4444-4444-8444-444444444444", kind: "general", status: "approved", title: "Flat-fee letter", approvedAt: "2026-11-12T16:00:00Z" }),
        ],
      }),
      "approved",
    );
    const t = text(html);
    expect(t).toContain("Approved");
    expect(t).toContain("Start a new draft from this version");
    expect(html).not.toContain("<textarea");
    expect(t).not.toContain("Save draft");
    expect(html).toContain('class="loe-readonly"');
    expect(html).toContain('name="versionId"');
    expect(t).not.toMatch(/>\s*Approve\s*</);
  });

  it("3b. versions list: retired and approved pills, newest first", async () => {
    const html = await render(
      ok({
        versions: [
          version({ id: "a1111111-1111-4111-8111-111111111111", version: 1, status: "retired" }),
          version({ id: "b2222222-2222-4222-8222-222222222222", version: 2, status: "approved", approvedAt: "2026-11-12T16:00:00Z" }),
        ],
      }),
    );
    const t = text(html);
    expect(t.indexOf("Version 2")).toBeLessThan(t.indexOf("Version 1"));
    expect(t).toContain("Retired");
    expect(t).toContain("Approved Nov 12, 2026");
  });

  it("4. tables missing: says it isn't switched on and shows no form", async () => {
    const html = await render({ status: "not-set-up" });
    const t = text(html);
    expect(t).toContain("The engagement letter isn't switched on for your firm yet. Lectual will turn it on.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<textarea");
    expect(t).not.toContain("Start a draft");
  });

  it("5. read failed: says it couldn't be loaded, never the empty state", async () => {
    const html = await render({ status: "unavailable" });
    const t = text(html);
    expect(t).toContain("couldn't be loaded");
    expect(t).not.toContain("No letter yet");
    expect(t).not.toContain("Start a draft");
    expect(html).not.toContain("<form");
  });

  it("6. an admin who is not a named approver: can edit a draft, has no Approve button, sees who can approve", async () => {
    const html = await render(ok({ canApprove: false, approvers: { status: "ok", names: ["Rebecca Ortiz", "Taylor Reed"] }, versions: [version({})] }));
    const t = text(html);
    expect(t).toContain("Save draft");
    expect(html).toContain("<textarea");
    expect(html).not.toMatch(/>Approve<\/button>/);
    expect(t).toContain("Can approve: Rebecca Ortiz, Taylor Reed.");
  });

  it("6b. approvers unreadable or none named are said out loud, never guessed", async () => {
    expect(text(await render(ok({ canApprove: false, approvers: { status: "unreadable" }, versions: [version({})] })))).toContain("Who can approve couldn't be loaded");
    expect(text(await render(ok({ canApprove: false, approvers: { status: "ok", names: [] }, versions: [version({})] })))).toContain("No one is named yet");
  });

  it("7. a viewer: reads the versions, with no form and no buttons", async () => {
    const html = await render(ok({ canEdit: false, canApprove: false, versions: [version({}), version({ id: "c3333333-3333-4333-8333-333333333333", kind: "general", status: "approved", title: "Flat letter" })] }));
    const t = text(html);
    expect(t).toContain("You can read the letters.");
    expect(t).toContain("Version 1");
    expect(t).toContain("Dear {{client_name}}");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<textarea");
  });

  it("a viewer with nothing written yet sees the empty sentence and no Start button", async () => {
    const html = await render(ok({ canEdit: false, canApprove: false }));
    expect(text(html)).toContain("No letter yet");
    expect(html).not.toContain("<button");
  });

  it("the page renders no raw HTML from a letter: tags and braces in a body are text", async () => {
    const html = await render(ok({ canEdit: false, canApprove: false, versions: [version({ status: "approved", body: "<script>alert(1)</script> {{client_name}}" })] }));
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("the firm's logo above the preview", () => {
  const draft = () => ok({ versions: [version({})] });
  it("RPB's preview carries its logo; another firm's, and a failed session read, none", async () => {
    load.mockResolvedValue(draft());
    session.mockResolvedValueOnce({ kind: "ok", org: { slug: "rpb-law" } });
    const rpb = await render(draft());
    expect(rpb).toContain('class="loe-preview-logo" src="/brand/rpb-logo-oxblood.png"');
    expect(await render(draft())).not.toContain("loe-preview-logo");
    session.mockResolvedValueOnce({ kind: "none" });
    expect(await render(draft())).not.toContain("loe-preview-logo");
  });
});
