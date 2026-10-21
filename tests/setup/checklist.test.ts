import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { setupChecklist } from "@/lib/setup/checklist";
import { canSeeSetup } from "@/lib/setup/roles";
import { INTEGRATIONS_PATH, MODULES_PATH, SETUP_PATH } from "@/lib/setup/routes";
import type { SetupItemId, SetupState } from "@/lib/setup/types";
import { ALL_DONE, ITEM_IDS, NOTHING_DONE, OTHER_ROLES, READS_OF, ROLE_NAMES, ADMIN_TIER, bad, ok } from "./helpers";

const item = (state: SetupState, id: SetupItemId) => setupChecklist(state).items.find((i) => i.id === id)!;
const statuses = (state: SetupState) => Object.fromEntries(setupChecklist(state).items.map((i) => [i.id, i.status]));

describe("shape", () => {
  it("is exactly ten items in the contract's order, total 10", () => {
    for (const state of [NOTHING_DONE, ALL_DONE]) {
      const c = setupChecklist(state);
      expect(c.items.map((i) => i.id)).toEqual([...ITEM_IDS]);
      expect(c.items.map((i) => i.label)).toEqual([
        "Firm profile and sign-off",
        "Team invited",
        "Outlook mailbox connected",
        "Lawmatics connected",
        "Fathom or Zoom connected",
        "LawPay connected",
        "At least one agent on",
        "An intake form live",
        "Packages saved",
        "AI configured",
      ]);
      expect(c.total).toBe(10);
    }
  });

  it("counts done items, and is complete only when all ten are done", () => {
    expect(setupChecklist(NOTHING_DONE)).toMatchObject({ doneCount: 0, complete: false });
    expect(setupChecklist(ALL_DONE)).toMatchObject({ doneCount: 10, complete: true });
    const nine = setupChecklist({ ...ALL_DONE, aiConfigured: false });
    expect(nine).toMatchObject({ doneCount: 9, complete: false });
  });

  it("is pure: the same input gives the same output twice, and the input is not changed", () => {
    const before = JSON.stringify(ALL_DONE);
    expect(setupChecklist(ALL_DONE)).toEqual(setupChecklist(ALL_DONE));
    expect(JSON.stringify(ALL_DONE)).toBe(before);
  });
});

/** One case per item: the facts that make ONLY that item done, and the facts one step short of it. */
const CASES: { id: SetupItemId; done: Partial<SetupState>; short: Partial<SetupState>[] }[] = [
  {
    id: "profile",
    done: { profile: ok({ displayName: "Hartwell IP", emailSignature: "Best, Hartwell" }) },
    short: [
      { profile: ok({ displayName: "Hartwell IP", emailSignature: "" }) },
      { profile: ok({ displayName: "Hartwell IP", emailSignature: "   " }) },
      { profile: ok({ displayName: null, emailSignature: "Best" }) },
      { profile: ok({ displayName: "  ", emailSignature: "Best" }) },
      { profile: ok(null) },
    ],
  },
  { id: "team", done: { members: ok({ count: 2 }) }, short: [{ members: ok({ count: 1 }) }, { members: ok({ count: 0 }) }] },
  {
    id: "outlook",
    done: { mailboxes: ok([{ provider: "microsoft", status: "active" }]) },
    short: [
      { mailboxes: ok([{ provider: "google", status: "active" }]) },
      { mailboxes: ok([{ provider: "microsoft", status: "reauth" }]) },
      { mailboxes: ok([{ provider: "microsoft", status: "error" }]) },
      { mailboxes: ok([]) },
    ],
  },
  {
    id: "lawmatics",
    done: { lawmatics: ok({ status: "active" }) },
    short: [{ lawmatics: ok(null) }, { lawmatics: ok({ status: "invalid" }) }, { lawmatics: ok({ status: "revoked" }) }],
  },
  {
    id: "meetings",
    done: { meetings: ok([{ provider: "zoom", status: "active" }]) },
    short: [{ meetings: ok([]) }, { meetings: ok([{ provider: "fathom", status: "reauth" }]) }],
  },
  {
    id: "lawpay",
    done: { lawpay: ok({ status: "active" }) },
    short: [{ lawpay: ok(null) }, { lawpay: ok({ status: "reauth" }) }, { lawpay: ok({ status: "revoked" }) }],
  },
  {
    id: "agents",
    done: { agents: ok([{ enabled: false }, { enabled: true }]) },
    short: [{ agents: ok([]) }, { agents: ok([{ enabled: false }, { enabled: false }]) }],
  },
  {
    id: "intake",
    done: { intakeForms: ok([{ status: "draft" }, { status: "live" }]) },
    short: [{ intakeForms: ok([]) }, { intakeForms: ok([{ status: "draft" }]) }, { intakeForms: ok([{ status: "archived" }]) }],
  },
  {
    id: "packages",
    done: { services: ok([{ active: true, kind: "legal_fee" }]) },
    short: [
      { services: ok([]) },
      { services: ok([{ active: false, kind: "legal_fee" }]) },
      { services: ok([{ active: true, kind: "government_fee" }]) },
      { services: ok([{ active: true, kind: "expense" }]) },
    ],
  },
  { id: "ai", done: { aiConfigured: true }, short: [{ aiConfigured: false }] },
];

describe("each item", () => {
  it.each(CASES)("$id is done on its own facts, and only that item", ({ id, done }) => {
    const s = statuses({ ...NOTHING_DONE, ...done });
    expect(s[id]).toBe("done");
    for (const other of ITEM_IDS) if (other !== id) expect(s[other], `${other} next to ${id}`).toBe("to-do");
  });

  it.each(CASES)("$id is to-do one step short, with a different why-line", ({ id, done, short }) => {
    const doneWhy = item({ ...NOTHING_DONE, ...done }, id).why;
    for (const facts of short) {
      const i = item({ ...ALL_DONE, ...facts }, id);
      expect(i.status, JSON.stringify(facts)).toBe("to-do");
      expect(i.why).not.toBe(doneWhy);
      expect(i.why.length).toBeGreaterThan(0);
    }
  });

  it("names what is missing in the profile", () => {
    expect(item({ ...ALL_DONE, profile: ok({ displayName: "Hartwell IP", emailSignature: "" }) }, "profile").why).toContain("sign-off");
    expect(item({ ...ALL_DONE, profile: ok({ displayName: "", emailSignature: "Best" }) }, "profile").why).toContain("display name");
  });

  it("the Outlook item says a Gmail-only firm still needs Outlook, and that it may be yours or a shared one", () => {
    const gmail = item({ ...ALL_DONE, mailboxes: ok([{ provider: "google", status: "active" }]) }, "outlook");
    expect(gmail.why).toMatch(/Gmail/);
    expect(gmail.why).toMatch(/yours or a shared one/);
    expect(item({ ...ALL_DONE, mailboxes: ok([]) }, "outlook").why).toMatch(/yours or a shared one/);
    expect(item(ALL_DONE, "outlook").why).toMatch(/yours or a shared one/);
  });

  it("the AI item says Lectual sets the key", () => {
    expect(item({ ...ALL_DONE, aiConfigured: false }, "ai").why).toBe("The AI key isn't set on this deployment. Lectual sets it.");
  });
});

describe("couldn't check", () => {
  const UNREADABLE: { id: SetupItemId; key: keyof SetupState }[] = [
    { id: "profile", key: "profile" },
    { id: "team", key: "members" },
    { id: "outlook", key: "mailboxes" },
    { id: "lawmatics", key: "lawmatics" },
    { id: "meetings", key: "meetings" },
    { id: "lawpay", key: "lawpay" },
    { id: "agents", key: "agents" },
    { id: "intake", key: "intakeForms" },
    { id: "packages", key: "services" },
  ];

  it.each(UNREADABLE)("$id: an unreadable $key is couldn't-check, never done and never to-do, with its own why-line", ({ id, key }) => {
    for (const base of [ALL_DONE, NOTHING_DONE]) {
      const i = item({ ...base, [key]: bad }, id);
      expect(i.status).toBe("couldnt-check");
      expect(i.why).toMatch(/couldn't check/i);
      expect(i.why).toMatch(/Try again shortly/);
      expect(i.why).toContain('not the same as "to do"');
      expect(i.why).not.toBe(item(ALL_DONE, id).why);
    }
  });

  it("with all nine readable items unreadable at once, at most the AI item is done and it is not complete", () => {
    const allBad: SetupState = {
      profile: bad,
      members: bad,
      modules: bad,
      mailboxes: bad,
      lawmatics: bad,
      meetings: bad,
      lawpay: bad,
      agents: bad,
      intakeForms: bad,
      services: bad,
      aiConfigured: true,
    };
    const c = setupChecklist(allBad);
    expect(c.doneCount).toBe(1);
    expect(c.complete).toBe(false);
    expect(c.items.filter((i) => i.status === "couldnt-check")).toHaveLength(9);
    expect(item(allBad, "ai").status).toBe("done");
    expect(setupChecklist({ ...allBad, aiConfigured: false }).doneCount).toBe(0);
  });

  it("over every combination of readable and unreadable, an unreadable item is never done and never makes it complete", () => {
    const keys = ["profile", "members", "modules", "mailboxes", "lawmatics", "meetings", "lawpay", "agents", "intakeForms", "services"] as const;
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const state: SetupState = { ...ALL_DONE };
      const broken = new Set<string>();
      keys.forEach((k, bit) => {
        if (mask & (1 << bit)) {
          (state as Record<string, unknown>)[k] = bad;
          broken.add(k);
        }
      });
      const c = setupChecklist(state);
      for (const i of c.items) {
        const dependsOnBroken = READS_OF[i.id].some((k) => broken.has(k));
        if (dependsOnBroken) expect(i.status, `${i.id} mask ${mask}`).toBe("couldnt-check");
        else expect(i.status, `${i.id} mask ${mask}`).toBe("done");
      }
      expect(c.doneCount).toBe(c.items.filter((i) => i.status === "done").length);
      expect(c.items.some((i) => i.status === "couldnt-check")).toBe(broken.size > 0);
      if (broken.size > 0) expect(c.complete).toBe(false);
    }
  });
});

describe("a module that is off", () => {
  it.each([
    ["outlook", "mailbox", "Mailboxes"],
    ["agents", "agents", "Agents"],
  ] as const)("%s is to-do, says it is not switched on for the firm, and links to Modules", (id, mod, noun) => {
    const modules = ok(["mailbox", "agents"].filter((m) => m !== mod));
    const i = item({ ...ALL_DONE, modules }, id);
    expect(i.status).toBe("to-do");
    expect(i.why).toContain(`${noun} aren't switched on for your firm`);
    expect(i.why).toContain("Lectual turns them on");
    expect(i.href).toBe(MODULES_PATH);
    expect(statuses({ ...ALL_DONE, modules })[id === "outlook" ? "agents" : "outlook"]).toBe("done");
  });

  it("stays to-do even when the connection facts look finished, and with no module at all", () => {
    const none = statuses({ ...ALL_DONE, modules: ok([]) });
    expect(none.outlook).toBe("to-do");
    expect(none.agents).toBe("to-do");
    expect(setupChecklist({ ...ALL_DONE, modules: ok([]) }).total).toBe(10);
  });

  it("with the module list unreadable, both module items are couldn't-check, not to-do", () => {
    const s = statuses({ ...ALL_DONE, modules: bad });
    expect(s.outlook).toBe("couldnt-check");
    expect(s.agents).toBe("couldnt-check");
  });

  it("with the module on, the item links to its own page", () => {
    expect(item(NOTHING_DONE, "outlook").href).toBe(INTEGRATIONS_PATH);
    expect(item(NOTHING_DONE, "agents").href).toBe("/dashboard/agents/");
  });
});

describe("a connection that needs reconnecting", () => {
  const cases: [string, SetupItemId, Partial<SetupState>][] = [
    ["Lawmatics invalid", "lawmatics", { lawmatics: ok({ status: "invalid" }) }],
    ["Lawmatics revoked", "lawmatics", { lawmatics: ok({ status: "revoked" }) }],
    ["LawPay reauth", "lawpay", { lawpay: ok({ status: "reauth" }) }],
    ["LawPay revoked", "lawpay", { lawpay: ok({ status: "revoked" }) }],
    ["a meeting source in reauth", "meetings", { meetings: ok([{ provider: "zoom", status: "reauth" }]) }],
    ["a Microsoft mailbox in reauth", "outlook", { mailboxes: ok([{ provider: "microsoft", status: "reauth" }]) }],
    ["a Microsoft mailbox in error", "outlook", { mailboxes: ok([{ provider: "microsoft", status: "error" }]) }],
  ];
  it.each(cases)("%s is to-do and says to reconnect", (_name, id, facts) => {
    const i = item({ ...ALL_DONE, ...facts }, id);
    expect(i.status).toBe("to-do");
    expect(i.why).toMatch(/reconnect/i);
  });

  it("not connected at all says so instead", () => {
    expect(item({ ...ALL_DONE, lawmatics: ok(null) }, "lawmatics").why).toMatch(/Not connected yet/);
    expect(item({ ...ALL_DONE, lawmatics: ok(null) }, "lawmatics").why).not.toMatch(/reconnect/i);
  });

  it("Fathom active with Zoom in reauth is done: one active source is enough", () => {
    const meetings = ok([
      { provider: "fathom", status: "active" },
      { provider: "zoom", status: "reauth" },
    ]);
    expect(item({ ...NOTHING_DONE, meetings }, "meetings").status).toBe("done");
  });
});

describe("links and wording", () => {
  const app = path.resolve(__dirname, "../../src/app");
  const exists = (href: string) => fs.existsSync(path.join(app, href, "page.tsx"));

  it("every item has a non-empty why-line and a link to a route that exists", () => {
    for (const state of [NOTHING_DONE, ALL_DONE, { ...NOTHING_DONE, modules: ok([]) }, { ...ALL_DONE, modules: bad }]) {
      for (const i of setupChecklist(state).items) {
        expect(i.why.trim().length).toBeGreaterThan(0);
        expect(i.href).toMatch(/^\/dashboard\/.*\/$/);
        expect(exists(i.href), i.href).toBe(true);
      }
    }
  });

  it("the three shared paths exist as pages", () => {
    for (const p of [SETUP_PATH, INTEGRATIONS_PATH, MODULES_PATH]) expect(exists(p), p).toBe(true);
  });

  it("no why-line implies legal advice or says anything was sent to a client", () => {
    const all = [NOTHING_DONE, ALL_DONE, { ...NOTHING_DONE, modules: bad }].flatMap((s) => setupChecklist(s).items.map((i) => i.why));
    for (const why of all) expect(why).not.toMatch(/legal advice|\bsent\b|lorem|TODO|coming soon/i);
  });
});

describe("canSeeSetup", () => {
  it.each([...ADMIN_TIER])("is true for %s", (role) => expect(canSeeSetup(role)).toBe(true));
  it.each([...OTHER_ROLES])("is false for %s", (role) => expect(canSeeSetup(role)).toBe(false));
  it.each([null, undefined, "", "Owner", "root", "admin ", "superadmin"])("fails closed for %j", (role) => expect(canSeeSetup(role as string | null | undefined)).toBe(false));
  it("covers every role in the app", () => expect(ROLE_NAMES).toHaveLength(10));
});
