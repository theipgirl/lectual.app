import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { candidatesOf, walk } from "../ui/_scan";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { urlWithoutResultParams } from "@/lib/integrations/clear-params";
import { MODULES } from "@/lib/settings/modules-copy";
import { friendlyZoneLabel, firmFormDirty, firmFormValues, zoneOptions, SIGNOFF_PLACEHOLDER, type FirmFormValues } from "@/lib/org/firm-form";
import { timeZoneOptions } from "@/lib/org/profile-rules";
import { packageExample } from "@/lib/proposals/package-example";
import { quoteProposal } from "@/lib/proposals/pricing";
import { approverPick, MAX_APPROVERS } from "@/lib/proposals/approver-pick";
import { inviteFormOpen } from "@/lib/team/invite-open";
import { nextConfirm } from "@/lib/ui/inline-confirm";
import { SERVICE_LIBRARY_READ_ONLY } from "@/lib/ui/words";

const read = (p: string) => readFileSync(p, "utf8");
/** Every `@media (query) { ... }` block in the stylesheet, joined. */
const media = (css: string, query: string) => {
  const out: string[] = [];
  const marker = `@media (${query})`;
  for (let start = css.indexOf(marker); start >= 0; start = css.indexOf(marker, start + 1)) {
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        out.push(css.slice(start, i + 1));
        break;
      }
    }
  }
  return out.join("\n");
};

describe("item 1: the Settings side menu is a sideways-scrolling strip under 900px", () => {
  it("is in the stylesheet", () => {
    const css = media(read("src/app/globals.css"), "max-width: 900px");
    expect(css).toMatch(/\.lx-settings-nav\s*\{[^}]*overflow-x:\s*auto/);
  });
});

describe("item 2: one phrase for who may change settings", () => {
  const dirs = ["src/app/dashboard/settings", "src/components/integrations", "src/components/settings", "src/components/agents", "src/app/dashboard/forms", "src/lib/payments/accounts.ts", "src/app/dashboard/proposals/gate.ts"];
  const BAD = /\bsenior admins and owners\b|\bfirm(?:&apos;|'|’)s (?:admins|principals)\b|\bowners? (and|or) admins?\b|\bowners?, admins?\b|\ban administrator\b|\ban owner or admin\b|\bowner,? admin or senior admin\b/i;

  it("no settings page, action or component says it another way", () => {
    const hits = dirs
      .flatMap((d) => walk(d))
      .flatMap((f) => candidatesOf(f).filter((c) => BAD.test(c.text)).map((c) => `${f}:${c.line} ${c.text}`));
    expect(hits).toEqual([]);
  });

  it("the phrase is Senior admin or above, and the meeting import/connect actions use it", () => {
    expect(ADMIN_TIER_PHRASE).toBe("Senior admin or above");
    expect(read("src/app/dashboard/settings/integrations/meetings/actions.ts")).not.toMatch(/Only owners/);
  });
});

describe("item 3: packages have one name and one editor", () => {
  it("exactly one component renders the package-price fields", () => {
    const hits = walk("src").filter((f) => /name=\{`pkg\.\$\{n\}\./.test(read(f)));
    expect(hits).toEqual(["src/components/proposal-editor/PackagePricesForm.tsx"]);
  });

  it("its heading is Packages, and the proposal editor points at Settings", () => {
    expect(read("src/components/proposal-editor/PackagePricesForm.tsx")).toMatch(/>\s*Packages\s*</);
    expect(read("src/components/proposal-editor/Sections.tsx")).toContain("Packages are edited in Settings → Proposals");
  });
});

describe("item 4: Integrations", () => {
  it("the calendar reconnect button reads Allow calendar", () => {
    expect(read("src/app/dashboard/settings/integrations/page.tsx")).toContain("Allow calendar");
  });

  it("the ?connected= banner clears from the URL; other params stay", () => {
    expect(urlWithoutResultParams("/dashboard/settings/integrations/", "?connected=google")).toBe("/dashboard/settings/integrations/");
    expect(urlWithoutResultParams("/dashboard/settings/integrations/", "?connected=microsoft&reconnected=1&tab=x")).toBe("/dashboard/settings/integrations/?tab=x");
    expect(urlWithoutResultParams("/dashboard/settings/integrations/", "?error=failed")).toBe("/dashboard/settings/integrations/");
    expect(urlWithoutResultParams("/dashboard/settings/integrations/", "")).toBeNull();
    expect(urlWithoutResultParams("/dashboard/settings/integrations/", "?tab=x")).toBeNull();
    expect(read("src/app/dashboard/settings/integrations/page.tsx")).toContain("<ClearResultParams />");
    expect(read("src/components/integrations/ClearResultParams.tsx")).toContain("replaceState");
  });

  it("the Lawmatics LOE fields sit in a closed details titled Advanced", () => {
    const src = read("src/app/dashboard/settings/integrations/lawmatics/page.tsx");
    const at = src.indexOf("<summary>Advanced</summary>");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(src.lastIndexOf("<details", at), at)).not.toMatch(/\sopen\b/);
    expect(src.indexOf("LoeFieldsForm config")).toBeGreaterThan(at);
  });

  it("LawPay's primary line has no ids or mode words; the detail is in a details element", () => {
    const src = read("src/app/dashboard/settings/integrations/lawpay/page.tsx");
    expect(src).toContain("<summary>Details</summary>");
    expect(src).toContain("<summary>Account details</summary>");
    expect(src).not.toContain("Live mode</span>");
    expect(src).not.toContain('"Test mode"');
  });
});

describe("item 5: Team", () => {
  it("the invite form is open for a team under three, folded otherwise, folded when the team could not be read", () => {
    expect(inviteFormOpen(1, false)).toBe(true);
    expect(inviteFormOpen(2, false)).toBe(true);
    expect(inviteFormOpen(3, false)).toBe(false);
    expect(inviteFormOpen(9, false)).toBe(false);
    expect(inviteFormOpen(0, true)).toBe(false);
    expect(read("src/app/dashboard/settings/team/page.tsx")).toContain("open={inviteFormOpen(members.length, loadError) || undefined}");
  });

  it("person cards stack under 700px", () => {
    const css = media(read("src/app/globals.css"), "max-width: 700px");
    expect(css).toMatch(/\.lx-team-tbl td\[data-label\]::before/);
    expect(css).toMatch(/\.lx-team-tbl tr\s*\{[^}]*display:\s*block|\.lx-team-tbl tr\s*\{ display: block/);
  });

  it("Confirm acts; Cancel and asking do nothing", () => {
    expect(nextConfirm("idle", "ask")).toEqual({ state: "asking", fire: false });
    expect(nextConfirm("asking", "cancel")).toEqual({ state: "idle", fire: false });
    expect(nextConfirm("asking", "confirm")).toEqual({ state: "idle", fire: true });
    expect(nextConfirm("idle", "confirm").fire).toBe(false);
  });

  it("the confirm shows its question with Confirm and Cancel; no browser confirm is left", async () => {
    const { InlineConfirm } = await import("@/components/ui/InlineConfirm");
    const asking = renderToStaticMarkup(createElement(InlineConfirm, { label: "Remove", question: "Remove Sam from the firm?", onConfirm: vi.fn(), initial: "asking" }));
    expect(asking).toContain("Remove Sam from the firm?");
    expect(asking).toMatch(/>Confirm</);
    expect(asking).toMatch(/>Cancel</);
    expect(renderToStaticMarkup(createElement(InlineConfirm, { label: "Archive", question: "q", onConfirm: vi.fn() }))).toMatch(/>Archive</);
    for (const f of ["src/components/settings/TeamForms.tsx", "src/app/dashboard/forms/_components/IntakeList.tsx"]) {
      expect(read(f)).not.toMatch(/window\.confirm|[^.\w]confirm\(/);
      expect(read(f)).toContain("InlineConfirm");
    }
  });
});

describe("item 6: Firm profile", () => {
  it("friendly time zone labels, with the IANA id as the value, for every option", () => {
    expect(friendlyZoneLabel("America/New_York")).toBe("Eastern Time (New York)");
    expect(friendlyZoneLabel("America/Los_Angeles")).toBe("Pacific Time (Los Angeles)");
    const ids = timeZoneOptions();
    const options = zoneOptions();
    expect(options.map((o) => o.value)).toEqual(ids);
    for (const o of options) {
      expect(o.label.length).toBeGreaterThan(0);
      expect(ids).toContain(o.value);
    }
  });

  it("the sign-off placeholder has no legal wording", () => {
    expect(SIGNOFF_PLACEHOLDER).toBe("e.g. Rebecca Beliard, Attorney · RPB Law Firm · (555) 555-0100");
    expect(SIGNOFF_PLACEHOLDER).not.toMatch(/legal advice|engagement letter/i);
  });

  const saved: FirmFormValues = { displayName: "RPB", timeZone: "America/New_York", emailSignature: "Rebecca", strategySessionUrl: "", discoveryCallUrl: "", nurtureSequenceId: "" };
  it("dirty only when a field differs from the saved value", () => {
    expect(firmFormDirty(saved, { ...saved })).toBe(false);
    expect(firmFormDirty(saved, { ...saved, displayName: " RPB " })).toBe(false);
    expect(firmFormDirty(saved, { ...saved, emailSignature: "Rebecca\r\n" })).toBe(false);
    expect(firmFormDirty(saved, { ...saved, timeZone: "America/Chicago" })).toBe(true);
    expect(firmFormDirty(saved, { ...saved, discoveryCallUrl: "https://x.example" })).toBe(true);
    const fd = new FormData();
    fd.set("displayName", "RPB");
    expect(firmFormValues(fd).displayName).toBe("RPB");
  });

  it("two cards, the unsaved bar, and Ask us opening feedback", async () => {
    const src = read("src/components/settings/FirmProfileForm.tsx");
    expect(src).toContain("Firm details");
    expect(src).toContain("Booking links and nurture");
    expect(src).toContain('data-save-bar role="region" aria-label="Unsaved changes"');
    expect(src).toContain("props.canEdit && dirty");
    expect(read("src/app/dashboard/settings/firm/page.tsx")).toContain("<FeedbackLink>Ask us</FeedbackLink>");
    expect(read("src/components/feedback/SendFeedbackButton.tsx")).toContain("requestFeedback(window");
  });
});

describe("item 7: proposal settings", () => {
  const values = { package: "Concierge", base: "4950.00", includedClasses: "3", perClass: "825.00", secondMarkPct: "20", govPerClass: "350.00" };

  it("the example line equals the engine's own quote for a flat-up-to-included package", () => {
    const ex = packageExample(values);
    expect(ex.ok).toBe(true);
    if (!ex.ok) return;
    const content = {
      client: { first_name: "", full_name: "" },
      greeting: "",
      pricing: { package: "Concierge", base_cents: 495000, included_classes: 3, per_class_cents: 82500, second_mark_discount_pct: 20, gov_per_class_cents: 35000 },
      names: [{ id: "n", name: "x", marks: [{ id: "m", kind: "word" as const, desc: "", preselected: true }], classes: [{ id: "a", label: "a", preselected: true }, { id: "b", label: "b", preselected: true }] }],
      adjustments: [],
      includes: [],
    };
    const q = quoteProposal(content, { m: true, a: true, b: true });
    expect(ex.legalCents).toBe(q.legal_total_cents);
    expect(ex.govCents).toBe(q.gov_total_cents);
    // Two classes under three included: flat, so the legal price is the base. USPTO is $350 x 2.
    expect(ex.legalCents).toBe(495000);
    expect(ex.govCents).toBe(70000);
    expect(ex.text).toBe("1 mark, 2 classes = $4,950.00 legal + $700.00 USPTO");
  });

  it("changes when a price field changes, and asks for numbers when one is not a number", () => {
    const a = packageExample(values);
    const b = packageExample({ ...values, base: "5500" });
    const c = packageExample({ ...values, includedClasses: "1" });
    expect(a.text).not.toBe(b.text);
    expect(c.ok && c.legalCents).toBe(495000 + 82500);
    expect(packageExample({ ...values, base: "abc" })).toEqual({ ok: false, text: "Fill in the prices to see an example." });
  });

  it("approvers: N of 10 chosen, unchecked boxes lock at 10", () => {
    expect(MAX_APPROVERS).toBe(10);
    expect(approverPick(["a", "b"]).summary).toBe("2 of 10 chosen");
    expect(approverPick(["a"]).disabled("z")).toBe(false);
    const ten = Array.from({ length: 10 }, (_, i) => `u${i}`);
    const pick = approverPick(ten);
    expect(pick.summary).toBe("10 of 10 chosen");
    expect(pick.disabled("other")).toBe(true);
    expect(pick.disabled("u3")).toBe(false);
  });

  it("the package-example module and the form never multiply cents themselves", () => {
    for (const f of ["src/lib/proposals/package-example.ts", "src/components/proposal-editor/PackagePricesForm.tsx"]) {
      expect(read(f)).not.toMatch(/_cents\s*\*|\*\s*\w*_cents|Cents\s*\*|\*\s*\w*Cents/);
      expect(read(f)).not.toMatch(/cents\s*\*|\*\s*cents/i);
    }
    expect(read("src/lib/proposals/package-example.ts")).toContain("quoteProposal(");
  });
});

describe("item 8: Service library", () => {
  it("a read-only member sees one plain sentence from the glossary", () => {
    expect(SERVICE_LIBRARY_READ_ONLY).toBe("You can use these on quotes. Senior admin or above can change the list.");
    expect(read("src/app/dashboard/settings/services/page.tsx")).toContain("{SERVICE_LIBRARY_READ_ONLY}");
  });
});

describe("item 9: Features", () => {
  it("every description is under 15 words", () => {
    expect(MODULES.length).toBe(6);
    for (const m of MODULES) expect(m.what.trim().split(/\s+/).length, m.name).toBeLessThan(15);
  });

  it("'contact Lectual' is a button that opens Send feedback", async () => {
    const src = read("src/app/dashboard/settings/modules/page.tsx");
    expect(src).toContain("<FeedbackLink>{CONTACT_LECTUAL}</FeedbackLink>");
    const { FeedbackLink } = await import("@/components/feedback/SendFeedbackButton");
    const html = renderToStaticMarkup(createElement(FeedbackLink, null, "contact Lectual"));
    expect(html).toMatch(/^<button type="button"[^>]*>contact Lectual<\/button>$/);
  });
});
