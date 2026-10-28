import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { splitFullName, validateName, NAME_MAX } from "@/lib/account/name";
import { firmLogo, usableLogoPath } from "@/lib/org/logo";

/** Sprint 30 A (logo) and B (names). */

type User = { user_metadata?: Record<string, unknown> } | null;

async function loadAction(opts: { user: User; updateError?: { message: string } | null; getUserError?: boolean }) {
  vi.resetModules();
  const updateUser = vi.fn(async () => ({ error: opts.updateError ?? null }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: opts.user }, error: opts.getUserError ? { message: "boom" } : null })), updateUser },
    })),
  }));
  const { saveFullNameAction } = await import("@/lib/account/actions");
  return { saveFullNameAction, updateUser };
}

const signedIn = { user_metadata: { lectual_tour: { version: 1 }, lectual_hub: { version: 1, done: ["a"] }, full_name: "Old Name" } };

beforeEach(() => vi.resetModules());

describe("saveFullNameAction", () => {
  it("merges into the existing metadata and writes '<first> <last>' trimmed", async () => {
    const { saveFullNameAction, updateUser } = await loadAction({ user: signedIn });
    const res = await saveFullNameAction({ first: "  Rebecca ", last: " Pearl  " });
    expect(res).toEqual({ ok: true, fullName: "Rebecca Pearl" });
    expect(updateUser).toHaveBeenCalledWith({ data: { ...signedIn.user_metadata, full_name: "Rebecca Pearl" } });
  });

  it("a first name alone is a full name", async () => {
    const { saveFullNameAction, updateUser } = await loadAction({ user: signedIn });
    expect(await saveFullNameAction({ first: "Rebecca", last: "" })).toEqual({ ok: true, fullName: "Rebecca" });
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it("refuses signed-out, writing nothing", async () => {
    const { saveFullNameAction, updateUser } = await loadAction({ user: null });
    expect(await saveFullNameAction({ first: "Rebecca", last: "Pearl" })).toEqual({ ok: false, error: "You are not signed in." });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each([
    ["blank first name", { first: "   ", last: "Pearl" }],
    ["non-string first", { first: 42, last: "Pearl" }],
    ["non-string last", { first: "Rebecca", last: {} }],
    ["no input", null],
    ["too long first", { first: "a".repeat(NAME_MAX + 1), last: "" }],
    ["too long last", { first: "Rebecca", last: "b".repeat(NAME_MAX + 1) }],
    ["an @", { first: "rebecca@pearl.example", last: "" }],
    ["a control character", { first: "Rebe\u0000cca", last: "" }],
    ["a newline", { first: "Rebecca", last: "Pe\narl" }],
  ])("refuses %s with a fixed sentence and writes nothing", async (_label, input) => {
    const { saveFullNameAction, updateUser } = await loadAction({ user: signedIn });
    const res = await saveFullNameAction(input);
    expect(res.ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("a failing updateUser (or getUser) returns a fixed sentence with no provider text", async () => {
    const failed = await loadAction({ user: signedIn, updateError: { message: "SECRET provider detail" } });
    const res = await failed.saveFullNameAction({ first: "Rebecca", last: "Pearl" });
    expect(res).toEqual({ ok: false, error: "We couldn't save your name. Try again." });
    expect(JSON.stringify(res)).not.toContain("SECRET");
    const noUser = await loadAction({ user: signedIn, getUserError: true });
    expect(await noUser.saveFullNameAction({ first: "A", last: "B" })).toEqual({ ok: false, error: "We couldn't save your name. Try again." });
  });

  it("has no user or org parameter and never imports the admin client", () => {
    const src = fs.readFileSync("src/lib/account/actions.ts", "utf8");
    expect(src).toMatch(/saveFullNameAction\(input: unknown\)/);
    expect(src).not.toMatch(/@\/lib\/db\/admin|getAdminClient\(/);
  });
});

describe("name rules", () => {
  it("splits a stored name for the dialog and never offers an email as a name", () => {
    expect(splitFullName("Rebecca Anne Pearl")).toEqual({ first: "Rebecca", last: "Anne Pearl" });
    expect(splitFullName("Rebecca")).toEqual({ first: "Rebecca", last: "" });
    expect(splitFullName("a@b.com")).toEqual({ first: "", last: "" });
    expect(splitFullName(null)).toEqual({ first: "", last: "" });
    expect(validateName({ first: "A", last: "B" })).toMatchObject({ ok: true, fullName: "A B" });
  });
});

describe("Your name dialog and account menu", () => {
  it("the menu has a Your name entry that asks the one dialog to open", async () => {
    const { AccountMenu } = await import("@/components/shell/AccountMenu");
    const html = renderToStaticMarkup(<AccountMenu initials="RP" name="Rebecca" email="r@x.example" role="owner" firmName="Firm" activeOrgId="o" switchableFirms={[]} />);
    expect(html).toContain("Your name");
    const src = fs.readFileSync("src/components/shell/AccountMenu.tsx", "utf8");
    expect(src).toMatch(/requestNameDialog\(window/);
  });

  it("the dialog has first and last fields, Save and Cancel, and is pre-filled", async () => {
    const { YourNameDialogView } = await import("@/components/account/YourNameDialog");
    const html = renderToStaticMarkup(<YourNameDialogView first="Rebecca" last="Pearl" error={null} saving={false} onFirst={() => {}} onLast={() => {}} onSave={() => {}} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/name="first"[^>]*value="Rebecca"/);
    expect(html).toMatch(/name="last"[^>]*value="Pearl"/);
    expect(html).toContain(">Save<");
    expect(html).toContain(">Cancel<");
  });

  it("follows FeedbackDialog: Esc closes, Tab wraps, focus returns to the opener", () => {
    const src = fs.readFileSync("src/components/account/YourNameDialog.tsx", "utf8");
    expect(src).toContain("tourKeyAction");
    expect(src).toContain("focusRestoreTarget");
    expect(src).toContain("fb-dialog");
  });

  it("the layout mounts the dialog with the current full name", () => {
    const layout = fs.readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout).toMatch(/<YourNameDialog currentFullName=/);
  });
});

describe("Team settings shows the name", () => {
  it("reads the member's displayName and keeps the email fallback", () => {
    const src = fs.readFileSync("src/app/dashboard/settings/team/page.tsx", "utf8");
    expect(src).toContain('m.displayName ?? m.email ?? "Teammate"');
  });
});

describe("firmLogo (A)", () => {
  const exists = (p: string) => p === "/brand/test-dark.png";

  it("a firm with no entry gets null (the wordmark keeps the name as text)", () => {
    expect(firmLogo("org-x", "Firm X", "firm-x", { byOrg: {}, bySlug: {}, exists })).toBeNull();
  });

  it("an entry returns the src and the firm name as alt", () => {
    expect(firmLogo("org-1", "Pearl Law", null, { byOrg: { "org-1": "/brand/test-dark.png" }, bySlug: {}, exists })).toEqual({ src: "/brand/test-dark.png", alt: "Pearl Law" });
    expect(firmLogo("zzz", "Pearl Law", "pearl", { byOrg: {}, bySlug: { pearl: "/brand/test-dark.png" }, exists })).toEqual({ src: "/brand/test-dark.png", alt: "Pearl Law" });
  });

  it("never the cream file, never a file that isn't there, never outside /brand/", () => {
    expect(usableLogoPath("/brand/rpb-logo-cream.png", () => true)).toBe(false);
    expect(usableLogoPath("/brand/missing.png", exists)).toBe(false);
    expect(usableLogoPath("/other/test-dark.png", () => true)).toBe(false);
    expect(usableLogoPath("/brand/../x.png", () => true)).toBe(false);
  });

  it("RPB maps to the dark file only if it exists on disk (it does not yet, so the name shows)", () => {
    const onDisk = fs.existsSync("public/brand/rpb-logo-dark.png");
    expect(firmLogo("any", "RPB Law", "rpb-law") !== null).toBe(onDisk);
  });

  it("the map lives in one file and none of it points at the cream logo", () => {
    const src = fs.readFileSync("src/lib/org/logo.ts", "utf8");
    const entries = src.split("\n").filter((l) => /^export const LOGO_BY_/.test(l));
    expect(entries.join("\n")).not.toMatch(/cream/);
    expect(src).toMatch(/export function firmLogo/);
    const layout = fs.readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout).toContain("<FirmWordmark");
    expect(layout).not.toContain("rpb-logo-cream");
    expect(fs.readFileSync("src/components/shell/FirmWordmark.tsx", "utf8")).toContain("firmLogo(");
  });

  it("FirmWordmark renders an <img> with the alt when there is a logo, else the name", () => {
    const src = fs.readFileSync("src/components/shell/FirmWordmark.tsx", "utf8");
    expect(src).toMatch(/if \(!logo\) return/);
    expect(src).toContain("alt={logo.alt}");
    expect(src).toContain("org.name");
  });
});
