import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import path from "node:path";

const h = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: () => {} }));
vi.mock("@/app/sign-in/actions", () => ({ sendMagicLink: async () => ({}) }));
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>();
  return { ...actual, useActionState: (_fn: unknown, initial: unknown) => [Object.keys(h.state).length ? h.state : initial, () => {}, false] };
});

const { default: LoginForm } = await import("@/app/sign-in/LoginForm");
const { default: SignInPage } = await import("@/app/sign-in/page");
const { NOT_A_LAW_FIRM_DISCLAIMER } = await import("@/lib/legal/disclaimer");

describe("LoginForm", () => {
  it("starts as the form with a plain label and an empty email input", () => {
    h.state = {};
    const html = renderToStaticMarkup(<LoginForm next="/dashboard/" />);
    expect(html).toContain("Work email");
    expect(html).not.toContain("lx-label");
    expect(html).not.toMatch(/font-size:11/);
    expect(html).toMatch(/<input id="email"[^>]*name="email"/);
    expect(html).not.toMatch(/<input id="email"[^>]*value=/);
  });
  it("after ok shows the typed address, the spam hint, Resend (with the same email and next) and Use a different address", () => {
    h.state = { ok: true, email: "rita@firm.com", sends: 1 };
    const html = renderToStaticMarkup(<LoginForm next="/dashboard/matters/" />);
    expect(html).toContain("We sent a link to rita@firm.com.");
    expect(html).toContain("Check your spam or junk folder");
    expect(html).toMatch(/Resend (the link|in 30s)/);
    expect(html).toContain("Use a different address");
    expect(html).toContain('name="email" value="rita@firm.com"');
    expect(html).toContain('name="next" value="/dashboard/matters/"');
  });
  it("a refused resend shows its sentence in place, and a later send says Sent again", () => {
    h.state = { ok: true, email: "rita@firm.com", sends: 1, error: "Please wait a little before asking for another link." };
    expect(renderToStaticMarkup(<LoginForm next="/" />)).toContain("Please wait a little");
    h.state = { ok: true, email: "rita@firm.com", sends: 2 };
    expect(renderToStaticMarkup(<LoginForm next="/" />)).toContain("Sent again.");
  });
});

describe("sign-in page", () => {
  it("names who can sign in, keeps the disclaimer verbatim, and maps errors without echoing them", async () => {
    h.state = {};
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("Use the email your firm invited.");
    expect(html).toContain("Not invited yet? Ask your firm&#x27;s owner to invite you.");
    expect(html).toContain(NOT_A_LAW_FIRM_DISCLAIMER.replace(/'/g, "&#x27;"));
    const expired = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ error: "otp_expired" }) }));
    expect(expired).toContain("expired");
    const unknown = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ error: "<b>evil</b>" }) }));
    expect(unknown).not.toContain("evil");
  });
  it("source has no lx-label on the email label", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/sign-in/LoginForm.tsx"), "utf8");
    expect(src).not.toMatch(/htmlFor="email"[^>]*lx-label|fontSize: 11/);
  });
});
