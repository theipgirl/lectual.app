import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { Exchange } from "@/lib/copilot/client";
import { LEAD_ID, MATTER_ID } from "./helpers";

/** &#x27; / &amp; and React's text-node separators out, so assertions read like the screen. */
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&").replaceAll("<!-- -->", "");

afterEach(() => vi.useRealTimers());
beforeEach(() => vi.resetModules());

type Reads = {
  member?: { userId: string; displayName: string | null; identified?: boolean } | null;
  matters?: "ok" | "fail";
  deadlines?: "ok" | "fail";
  queue?: { status: "ok"; items: unknown[] } | { status: "unavailable" | "unconfigured"; items: [] };
  members?: "ok" | "fail";
};

const MATTERS = { open: 12, stalled: 4 };

async function renderPage(opts: { hour?: number; configured?: boolean; reads?: Reads; session?: unknown } = {}) {
  vi.resetModules();
  const reads = opts.reads ?? {};
  // 2026-10-21 at the given hour in New York (EDT, UTC-4).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 21, (opts.hour ?? 9) + 4, 30)));
  const userId = "u-1";
  vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => opts.configured ?? true }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => opts.session ?? { kind: "ok", user: { id: userId, email: "taylormcghee93@gmail.com", user_metadata: {} }, org: { id: "o-1" } }),
  }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/lib/members/directory", () => ({
    listMemberDirectory: vi.fn(async () => {
      if (reads.members === "fail") throw new Error("directory down");
      return reads.member === null ? [] : [{ userId, email: "t@example.com", displayName: "Taylor McGhee", identified: true, ...reads.member }];
    }),
  }));
  vi.doMock("@/lib/matters", () => ({
    listMatters: vi.fn(async () => {
      if (reads.matters === "fail") throw new Error("matters down");
      return ["m"];
    }),
    listUpcomingDeadlines: vi.fn(async () => {
      if (reads.deadlines === "fail") throw new Error("deadlines down");
      return [{}, {}, {}];
    }),
    summarizeDocket: () => ({ open: MATTERS.open, stalled: new Array(MATTERS.stalled).fill({}) }),
  }));
  vi.doMock("@/lib/queue/load", () => ({
    loadActiveQueue: vi.fn(async () => reads.queue ?? { status: "ok", items: [{}, {}] }),
  }));
  const { default: Page } = await import("@/app/dashboard/copilot/page");
  return text(renderToStaticMarkup(await Page()));
}

/** The four cards as { id, state, label, value, note }. */
function cards(html: string) {
  return [...html.matchAll(/<a class="cph-stat" data-stat="([a-z]+)" data-state="([a-z]+)" href="([^"]+)"><span class="cph-stat-label">([^<]*)<\/span><span class="cph-stat-value">([^<]*)<\/span><span class="cph-stat-note">([^<]*)<\/span><\/a>/g)].map(
    (m) => ({ id: m[1], state: m[2], href: m[3], label: m[4], value: m[5], note: m[6] }),
  );
}

describe("greeting", () => {
  it.each([
    [9, "Good morning, Taylor."],
    [14, "Good afternoon, Taylor."],
    [20, "Good evening, Taylor."],
  ])("at %i:00 in the firm's zone says %j followed by the question", async (hour, greeting) => {
    const html = await renderPage({ hour });
    expect(html).toContain(greeting);
    expect(html).toMatch(new RegExp(`${greeting.replace(".", "\\.")}</span> <span class="cph-greeting-b">What do you want to get done today\\?`));
  });

  it("uses the firm's clock, not the server's: 03:00 UTC is still the evening before in New York", async () => {
    vi.resetModules();
    const html = await renderPage({ hour: 23 });
    expect(html).toContain("Good evening, Taylor.");
  });

  it("with no usable first name says 'Good morning.' with no stray comma", async () => {
    const html = await renderPage({ hour: 9, reads: { member: null } });
    expect(html).toContain("Good morning.");
    expect(html).not.toContain("Good morning,");
  });

  it("an unreadable member directory still renders the page, with the nameless greeting", async () => {
    const html = await renderPage({ hour: 9, reads: { members: "fail" } });
    expect(html).toContain("Good morning.");
    expect(cards(html)).toHaveLength(4);
  });
});

describe("hero, pill and chips", () => {
  it("has the ask input labelled 'Ask the copilot' in the 640px pill", async () => {
    const html = await renderPage();
    expect(html).toContain('aria-label="Ask the copilot"');
    expect(html).toMatch(/<form[^>]*class="cpl-composer cpl-pill"/);
    expect(html).toContain("cph-hero");
  });

  it("shows exactly three suggestion chips as buttons, including the two-weeks one", async () => {
    const html = await renderPage();
    const chips = [...html.matchAll(/<button type="button" class="cpl-chip">([^<]*)<\/button>/g)].map((m) => m[1]);
    expect(chips).toHaveLength(3);
    expect(chips).toContain("What's due in the next two weeks?");
  });

  it("states the approval boundary and keeps the one-rule UPL block", async () => {
    const html = await renderPage();
    expect(html).toMatch(/never gives legal analysis/);
    expect(html).toMatch(/attorney of record/);
  });

  it("invents nothing: no matter number, statistic, sample thread, or hard-coded count", async () => {
    const html = await renderPage();
    expect(html).not.toMatch(/TM-\d{4}-\d{4}/);
    expect(html).not.toMatch(/reading \d+ matters/i);
    expect(html).not.toMatch(/Design preview|Illustrative|sample thread|lorem|TODO/i);
  });
});

describe("the four stat cards", () => {
  it("shows the real numbers, a real zero staying 0", async () => {
    const html = await renderPage({ reads: { queue: { status: "ok", items: [] } } });
    const c = cards(html);
    expect(c.map((x) => x.label)).toEqual(["Open matters", "Stalled matters", "Deadlines, next 14 days", "Approvals waiting"]);
    expect(c.map((x) => x.value)).toEqual(["12", "4", "3", "0"]);
    expect(c[3]).toMatchObject({ state: "ok", note: "drafts waiting for your review" });
    expect(html).not.toContain("Couldn't load");
  });

  it("one rejected read shows a dash and 'Couldn't load', not 0, and the other three keep their numbers", async () => {
    const c = cards(await renderPage({ reads: { deadlines: "fail" } }));
    expect(c[2]).toMatchObject({ id: "deadlines", state: "unavailable", value: "—", note: "Couldn't load" });
    expect(c.map((x) => x.value)).toEqual(["12", "4", "—", "2"]);
  });

  it("open and stalled share one matters read, so both fail together", async () => {
    const c = cards(await renderPage({ reads: { matters: "fail" } }));
    expect(c.map((x) => x.value)).toEqual(["—", "—", "3", "2"]);
    expect(c[0].note).toBe("Couldn't load");
    expect(c[1].note).toBe("Couldn't load");
  });

  it("an unavailable queue shows a dash and 'Couldn't load', never 0 or 'All caught up'", async () => {
    const html = await renderPage({ reads: { queue: { status: "unavailable", items: [] } } });
    expect(cards(html)[3]).toMatchObject({ state: "unavailable", value: "—", note: "Couldn't load" });
    expect(html).not.toMatch(/All caught up/i);
  });

  it("an unconfigured queue says 'Queue isn't connected', never 0 or 'All caught up'", async () => {
    const html = await renderPage({ reads: { queue: { status: "unconfigured", items: [] } } });
    expect(cards(html)[3]).toMatchObject({ state: "unconfigured", value: "—", note: "Queue isn't connected" });
    expect(html).not.toMatch(/All caught up/i);
  });

  it("with every read rejected the page still renders, four dashes", async () => {
    const html = await renderPage({ reads: { matters: "fail", deadlines: "fail", members: "fail", queue: { status: "unavailable", items: [] } } });
    expect(html).not.toContain("AI copilot");
    expect(cards(html).map((x) => x.value)).toEqual(["—", "—", "—", "—"]);
    expect(html).toContain("Good morning.");
  });

  it("each card links to a page that exists", async () => {
    const c = cards(await renderPage());
    expect(c).toHaveLength(4);
    for (const card of c) {
      const path = card.href.split("?")[0].replace(/\/$/, "");
      expect(existsSync(`src/app${path}/page.tsx`), `${card.href} should resolve to src/app${path}/page.tsx`).toBe(true);
    }
  });
});

describe("when AI is not configured", () => {
  it("shows the plain card: no composer, no hero, no stat cards, and reads nothing", async () => {
    const html = await renderPage({ configured: false });
    expect(html).toContain("isn't configured for this deployment yet");
    expect(html).not.toContain("cpl-composer");
    expect(html).not.toContain("cph-hero");
    expect(html).not.toContain("cph-stat");
    expect(html).not.toContain("Ask the copilot");
    expect(html).toMatch(/never gives legal analysis/);
  });
});

describe("the page is a server component and dynamic", () => {
  it("is force-dynamic and returns nothing for a session the layout already handled", async () => {
    const mod = await (async () => {
      await renderPage();
      return await import("@/app/dashboard/copilot/page");
    })();
    expect(mod.dynamic).toBe("force-dynamic");
    const html = await renderPage({ session: { kind: "signed-out", redirectTo: "/sign-in/" } });
    expect(html).toBe("");
  });
});

describe("the active thread", () => {
  const done = (over: Partial<Exchange> = {}): Exchange => ({ id: "d", question: "Which matters are stalled?", status: "done", answer: "Two matters.", citations: [], declined: false, readFailed: false, ...over });

  async function thread(exchanges: Exchange[], variant: "page" | "drawer" = "page") {
    vi.resetModules();
    const { CopilotChat } = await import("@/components/copilot/CopilotChat");
    return text(renderToStaticMarkup(<CopilotChat variant={variant} greeting="Good morning, Taylor." initialExchanges={exchanges} />));
  }

  it("draws the user bubble, the Copilot label, the answer and cite chips that link to the matter or lead", async () => {
    const html = await thread([
      done({
        citations: [
          { type: "matter", id: MATTER_ID, label: "TM-2026-0031 — AURELIA", href: `/dashboard/matters/${MATTER_ID}` },
          { type: "lead", id: LEAD_ID, label: "Doe Studio", href: `/dashboard/leads/${LEAD_ID}` },
        ],
      }),
    ]);
    expect(html).toContain('cpl-bubble cpl-bubble-user">Which matters are stalled?');
    expect(html).toContain('<div class="cpl-label">Copilot</div>');
    expect(html).toContain("Two matters.");
    expect(html).toContain(`<a class="cpl-cite" href="/dashboard/matters/${MATTER_ID}">TM-2026-0031 — AURELIA</a>`);
    expect(html).toContain(`<a class="cpl-cite" href="/dashboard/leads/${LEAD_ID}">Doe Studio</a>`);
    expect(html).not.toContain("No matter or lead record backs this");
  });

  it("says plainly when no record backs an answer", async () => {
    expect(await thread([done()])).toContain("No matter or lead record backs this");
  });

  it("labels a declined answer 'not a records question'", async () => {
    expect(await thread([done({ declined: true })])).toContain("Copilot · not a records question");
  });

  it("warns when a read failed", async () => {
    const html = await thread([done({ readFailed: true })]);
    expect(html).toContain("lx-banner-warn");
    expect(html).toContain("couldn't be read while answering");
  });

  it("shows an error exchange inline as an alert", async () => {
    const html = await thread([{ id: "e", question: "q", status: "error", error: "Couldn't reach the copilot — try again." }]);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Couldn't reach the copilot — try again.");
  });

  it("shows tool status text while pending, and streamed text as it arrives", async () => {
    const running = await thread([{ id: "p", question: "q", status: "pending", tools: ["Reading matters", "Checking deadlines"] }]);
    expect(running).toContain("Reading matters, Checking deadlines…");
    const streaming = await thread([{ id: "p", question: "q", status: "pending", streamed: "AURELIA is in " }]);
    expect(streaming).toContain("AURELIA is in ");
    const idle = await thread([{ id: "p", question: "q", status: "pending" }]);
    expect(idle).toContain("Reading the firm's records…");
  });

  it("tells the person when the page's own record couldn't be used", async () => {
    expect(await thread([done({ contextStatus: "not-found" })])).toContain("The record on this page couldn't be found");
    expect(await thread([done({ contextStatus: "unavailable" })])).toContain("The record on this page couldn't be read");
    expect(await thread([done({ contextStatus: "found" })])).not.toContain("The record on this page");
  });

  it("shows the approval footer, a follow-up composer and New thread in the active state", async () => {
    const html = await thread([done()]);
    expect(html).toContain("Nothing sends without your approval.");
    expect(html).toContain('placeholder="Ask a follow-up…"');
    expect(html).toContain(">New chat</button>");
    expect(html).not.toContain("cph-greeting");
  });

  it("renders answers and labels as text, never as markup", async () => {
    const html = await thread([done({ answer: "<img src=x onerror=alert(1)>", citations: [{ type: "matter", id: MATTER_ID, label: "<b>bold</b>", href: `/dashboard/matters/${MATTER_ID}` }] })]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;img");
  });

  it("the idle page variant shows the greeting, the pill and the chips, and no thread", async () => {
    const html = await thread([]);
    expect(html).toContain("Good morning, Taylor.");
    expect(html).toContain("What do you want to get done today?");
    expect(html).toContain("cpl-pill");
    expect(html).not.toContain("cpl-thread");
  });
});

describe("the stylesheets", () => {
  const page = readFileSync("src/app/dashboard/copilot/copilot.css", "utf8");
  const chat = readFileSync("src/components/copilot/copilot.css", "utf8");

  it("draws the hero with radial gradients in the five palette colours, defined once", () => {
    expect(page).toContain("radial-gradient");
    for (const colour of ["#9C949B", "#C7ADB2", "#B26A72", "#6A1F2B", "#230810"]) {
      expect(page.match(new RegExp(colour, "g"))).toHaveLength(1);
      expect(chat.toUpperCase()).not.toContain(colour);
    }
  });

  it("animates the hero and turns the animation off for reduced motion", () => {
    expect(page).toMatch(/\.cph-hero\s*{[^}]*animation:\s*cph-drift/);
    expect(page).toMatch(/@keyframes cph-drift/);
    expect(page).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{\s*\.cph-hero\s*{\s*animation:\s*none;/);
  });

  it("has the 640px pill and a four-column grid that collapses on narrow widths", () => {
    expect(chat).toMatch(/\.cpl-pill\s*{[^}]*width:\s*640px/);
    expect(page).toMatch(/grid-template-columns:\s*repeat\(4, 1fr\)/);
    expect(page).toMatch(/@media \(max-width: 900px\)[^@]*repeat\(2, 1fr\)/);
    expect(page).toMatch(/@media \(max-width: 560px\)[^@]*grid-template-columns:\s*1fr/);
  });

  it("is one scroll area on the page: no fixed or min() height and no thread overflow, only the drawer scrolls inside", () => {
    expect(chat).not.toContain(".cpl-panel");
    expect(page).not.toContain(".cpl-panel");
    expect(page).not.toMatch(/overflow-y/);
    expect(chat.replace(/\.cpl-drawer-chat[^{]*{[^}]*}/g, "")).not.toMatch(/overflow-y/);
    expect(chat).toMatch(/\.cpl-drawer-chat \.cpl-thread\s*{[^}]*overflow-y:\s*auto/);
    expect(page + chat).not.toMatch(/height:\s*min\(/);
  });

  it("styles a visible focus for every control", () => {
    for (const sel of [".cpl-chip:focus-visible", ".cpl-send:focus-visible", ".cpd-launcher:focus-visible", ".cpd-close:focus-visible", ".cph-stat:focus-visible"]) {
      expect(page + chat).toContain(sel);
    }
  });

  it("is loaded by the components themselves, so it is on every dashboard page", () => {
    expect(readFileSync("src/components/copilot/CopilotChat.tsx", "utf8")).toContain('import "./copilot.css"');
    expect(readFileSync("src/components/copilot/CopilotLauncher.tsx", "utf8")).toContain('import "./copilot.css"');
  });
});
