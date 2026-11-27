import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/app/sign-in/actions", () => ({ sendMagicLink: async () => ({}), verifySignInCode: async () => ({}) }));
vi.mock("@/app/auth/confirm/actions", () => ({ confirmSignIn: async () => {} }));

const { default: SignInPage } = await import("@/app/sign-in/page");
const { default: ConfirmPage } = await import("@/app/auth/confirm/page");
const W = await import("@/lib/ui/words");

const esc = (s: string) => s.replace(/'/g, "&#x27;");

/** The decorative panel's markup: from its opening tag to the end of the page (it is the last thing in <main>), up to </main>. */
function panelOf(html: string): string {
  const at = html.indexOf('class="lx-si-panel"');
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<div", at), html.indexOf("</main>", at));
}

describe("the sign-in shell", () => {
  it("has one h1, the trust chips and the four product lines, and the form comes before the panel", async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    for (const chip of W.SIGN_IN_TRUST_CHIPS) expect(html).toContain(chip);
    for (const line of W.SIGN_IN_PANEL_LINES) expect(html).toContain(line);
    expect(html.indexOf('id="email"')).toBeLessThan(html.indexOf("lx-si-panel"));
  });

  it("the panel is aria-hidden and holds only the caption and the product lines: no control, link, image, quote or name", async () => {
    for (const page of [
      await SignInPage({ searchParams: Promise.resolve({}) }),
      await ConfirmPage({ searchParams: Promise.resolve({ token_hash: "pkce_0123456789abcdef", type: "email" }) }),
    ]) {
      const panel = panelOf(renderToStaticMarkup(page));
      expect(panel).toMatch(/^<div[^>]*class="lx-si-panel"[^>]*aria-hidden="true"/);
      expect(panel).not.toMatch(/<(a|button|input|img|cite|blockquote|figcaption|svg)\b/);
      expect(panel).not.toMatch(/tabindex/i);
      const text = panel.replace(/<[^>]+>/g, "\n").split("\n").map((t) => t.trim()).filter(Boolean);
      expect(text).toEqual(["Lectual", ...W.SIGN_IN_PANEL_LINES.map(esc)]);
    }
  });

  it("says nothing it can't stand behind: the chips and lines are the decided ones, with no certification", () => {
    expect([...W.SIGN_IN_TRUST_CHIPS]).toEqual(["Isolated tenant per firm", "Attorney-gated actions", "Flat fees only"]);
    expect([...W.SIGN_IN_PANEL_LINES]).toEqual([
      "Agents draft. An attorney approves.",
      "A legal CRM remembers. Lectual acts.",
      "Nothing goes out until an attorney approves it.",
      "Every deadline, on the matter it belongs to.",
    ]);
    for (const s of [...W.SIGN_IN_TRUST_CHIPS, ...W.SIGN_IN_PANEL_LINES]) expect(s).not.toMatch(/\bSOC\b|\bISO\b|HIPAA|certif|[“”"]|!/i);
  });

  it("offers no sign-in method that does not exist", async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toMatch(/Google|Microsoft|Continue with/);
  });

  it("the confirm step uses the same shell and keeps the disclaimer", async () => {
    const html = renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve({ token_hash: "bad" }) }));
    expect(html).toContain('class="lx-si"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('role="alert"');
  });

  it("motion waits for the script and stops under reduced motion", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "src/app/sign-in/sign-in.css"), "utf8");
    const animated = [...css.matchAll(/^[^{}@]*animation:/gm)];
    expect(animated.length).toBeGreaterThan(0);
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*\banimation:/g)) expect(m[1]).toContain('[data-anim="on"]');
    const motionBlock = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(css.indexOf("animation:")).toBeGreaterThan(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    expect(motionBlock.length).toBeGreaterThan(0);
  });
});
