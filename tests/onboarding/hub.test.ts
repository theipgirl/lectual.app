import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROLES } from "@/lib/auth/roles";
import { canApproveQueue } from "@/lib/queue/roles";
import {
  EMPTY_PROGRESS,
  HUB_CENTERED,
  HUB_TRACKS,
  HUB_VERSION,
  allHubFlowIds,
  allHubSteps,
  buildHubMeta,
  hideCard,
  hubTracks,
  isHubFlowId,
  markFlowDone,
  mergeLocalDone,
  overallCount,
  parseHubProgress,
  pickFirstRecord,
  resetProgress,
  shouldShowHubCard,
  stepReset,
  trackCounts,
  visibleFlows,
  type HubContext,
} from "@/lib/onboarding/hub";

const ALL = ["mailbox", "proposals", "agents", "agent-toolkit", "litigation", "inbox", "document-center", "lawmatics-import"];
const ctx = (role: string, modules: string[] | null = ALL, aiConfigured = true, outlookConnectable = true): HubContext => ({ role, modules, aiConfigured, outlookConnectable });
const flowIds = (c: HubContext) => visibleFlows(c).map((f) => f.id);
const trackIds = (c: HubContext) => hubTracks(c).map((t) => t.id);

describe("catalog shape", () => {
  it("has the staff guide's track then the five tracks, in order", () => {
    // Changed on purpose: the staff guide's track ("start") comes first; the admin tier never sees it.
    expect(HUB_TRACKS.map((t) => t.id)).toEqual(["start", "intake", "consults", "matters", "approvals", "admin"]);
    expect(trackIds(ctx("owner"))).toEqual(["intake", "consults", "matters", "approvals", "admin"]);
  });

  it("gives each track 3 to 6 flows for an owner with every module", () => {
    for (const track of hubTracks(ctx("owner"))) {
      expect(track.flows.length, track.id).toBeGreaterThanOrEqual(3);
      expect(track.flows.length, track.id).toBeLessThanOrEqual(6);
    }
  });

  it("every step has a non-empty id, path, target, title and body", () => {
    for (const s of allHubSteps()) {
      for (const key of ["id", "path", "target", "title", "body"] as const) expect(s[key].trim().length, `${s.id}.${key}`).toBeGreaterThan(0);
    }
  });

  it("flow ids are unique and so are step ids within a flow", () => {
    const ids = allHubFlowIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const flow of visibleFlows(ctx("owner"))) {
      const steps = flow.steps.map((s) => s.id);
      expect(new Set(steps).size, flow.id).toBe(steps.length);
    }
  });

  it("flags every step on a record page with the record kind, and only those", () => {
    for (const s of allHubSteps()) {
      expect(s.path.includes("[id]"), s.id).toBe(!!s.record);
      if (s.record) {
        expect(s.path.startsWith(s.record === "lead" ? "/dashboard/leads/" : "/dashboard/matters/"), s.id).toBe(true);
        expect((s.unseen ?? "").length, s.id).toBeGreaterThan(0);
      }
    }
  });
});

describe("role x module matrix", () => {
  it("shows an owner with every module all five tracks", () => {
    expect(trackIds(ctx("owner"))).toHaveLength(5);
  });

  it.each(["viewer", "social_media"])("%s gets no Reconcile flow and no Admin track", (role) => {
    expect(flowIds(ctx(role))).not.toContain("intake-reconcile");
    expect(trackIds(ctx(role))).not.toContain("admin");
  });

  it.each(ROLES)("%s: the Admin track and Reconcile appear only for the admin tier", (role) => {
    const tier = ["owner", "admin", "senior_admin"].includes(role);
    expect(trackIds(ctx(role)).includes("admin")).toBe(tier);
    expect(flowIds(ctx(role)).includes("intake-reconcile")).toBe(tier);
  });

  // Changed on purpose: outside the admin tier the hub is the short staff guide only.
  it.each(ROLES)("%s: the Intake track is for the admin tier; everyone else gets the staff guide only", (role) => {
    const tier = ["owner", "admin", "senior_admin"].includes(role);
    expect(trackIds(ctx(role)).includes("intake")).toBe(tier);
    expect(trackIds(ctx(role))).toEqual(tier ? ["intake", "consults", "matters", "approvals", "admin"] : ["start"]);
  });

  it("without proposals the proposal flows go", () => {
    const ids = flowIds(ctx("owner", ALL.filter((m) => m !== "proposals")));
    expect(ids).not.toContain("consults-proposal");
    expect(ids).not.toContain("consults-accepted");
    expect(ids).toContain("consults-calendar");
  });

  it("without agents the Agents flow goes", () => {
    expect(flowIds(ctx("owner", ALL.filter((m) => m !== "agents")))).not.toContain("approvals-agents");
    expect(flowIds(ctx("owner"))).toContain("approvals-agents");
  });

  it("without agent-toolkit the prep and client-update flows go", () => {
    const ids = flowIds(ctx("owner", ALL.filter((m) => m !== "agent-toolkit")));
    expect(ids).not.toContain("consults-prep");
    expect(ids).not.toContain("matters-updates");
  });

  it("the Copilot flow needs the AI key", () => {
    expect(flowIds(ctx("owner", ALL, true))).toContain("approvals-copilot");
    expect(flowIds(ctx("owner", ALL, false))).not.toContain("approvals-copilot");
  });

  it("an empty module list shows only flows with no module", () => {
    const ids = flowIds(ctx("owner", []));
    for (const gated of ["consults-proposal", "consults-accepted", "approvals-agents", "consults-prep", "matters-updates"]) expect(ids).not.toContain(gated);
    expect(ids).toContain("intake-leads");
  });

  it("an unreadable module list behaves like an empty one", () => {
    expect(flowIds(ctx("owner", null))).toEqual(flowIds(ctx("owner", [])));
  });

  it("an unknown module name does not open anything", () => {
    expect(flowIds(ctx("owner", ["nonsense"]))).toEqual(flowIds(ctx("owner", [])));
  });

  // Changed on purpose: an unknown role fails closed to the staff guide, without the mailbox flow (it sees no rail section).
  it.each(["", "root", "OWNER", "superadmin"])("the unknown role %j gets the staff guide's name and tour flows only", (role) => {
    expect(flowIds(ctx(role))).toEqual(["staff-name", "staff-tour"]);
  });

  it("drops a track with no flow left rather than showing 0 of 0", () => {
    for (const role of ROLES) {
      for (const modules of [[], ...ALL.map((m) => [m]), ALL]) {
        for (const track of hubTracks(ctx(role, modules, false))) expect(track.flows.length, `${role}/${track.id}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("read-only wording", () => {
  const queueBody = (role: string) => visibleFlows(ctx(role)).find((f) => f.id === "approvals-queue")!.steps.find((s) => s.id === "queue")!.body;

  // Changed on purpose: no role that cannot approve sees the queue flow any more (they get the staff guide), so no approve wording reaches them.
  it.each(ROLES.filter((r) => !canApproveQueue(r)))("%s has no queue flow, so is not told they can approve", (role) => {
    expect(flowIds(ctx(role))).not.toContain("approvals-queue");
  });

  it("an unknown role has no queue flow at all, so no approve wording can reach it", () => {
    expect(flowIds(ctx("mystery"))).not.toContain("approvals-queue");
  });

  it.each(ROLES.filter((r) => canApproveQueue(r) && ["owner", "admin", "senior_admin"].includes(r)))("%s gets the approver wording", (role) => {
    expect(queueBody(role)).toMatch(/Nothing goes to a client until someone approves it/);
    expect(queueBody(role)).toMatch(/then approve or reject it/);
  });
});

describe("paths, targets and copy", () => {
  const dashboard = "src/app/dashboard";
  const pageFor = (path: string) => join(dashboard, ...path.split("?")[0].replace(/^\/dashboard\/?/, "").split("/").filter(Boolean), "page.tsx");

  it("every step path is a page on disk", () => {
    for (const s of allHubSteps()) expect(existsSync(pageFor(s.path)), `${s.id}: ${s.path}`).toBe(true);
  });

  it("every step ends in a trailing slash like the rest of the app", () => {
    for (const s of allHubSteps()) expect(s.path.split("?")[0].endsWith("/"), s.path).toBe(true);
  });

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) return sources(p);
      return /\.tsx?$/.test(name) ? [readFileSync(p, "utf8")] : [];
    });
  }
  const corpus = [...sources("src/app"), ...sources("src/components")].join("\n");

  it("every step target is a data-tour hook in the sources, or the centered marker", () => {
    for (const s of allHubSteps()) {
      if (s.target === HUB_CENTERED) continue;
      const hook = s.target.startsWith("nav-")
        ? corpus.includes("navTourToken")
        : new RegExp(`(?:data-tour|\\btour)=(?:"|\\{["'\`])${s.target}\\b`).test(corpus) || corpus.includes(`data-tour="${s.target}"`);
      expect(hook, `${s.id}: ${s.target}`).toBe(true);
    }
  });

  it("nav targets name a section the rail has", async () => {
    const { NAV } = await import("@/lib/nav");
    for (const s of allHubSteps().filter((x) => x.target.startsWith("nav-"))) {
      const slug = s.target === "nav-today" ? "" : s.target.slice(4);
      expect(NAV.some((n) => n.slug === slug), s.target).toBe(true);
    }
  });

  it("the copy makes no advice claim, no send claim, and names no person", () => {
    for (const flow of [...visibleFlows(ctx("owner")), ...visibleFlows(ctx("viewer"))]) {
      const text = [flow.title, flow.summary, ...flow.steps.flatMap((s) => [s.title, s.body, s.unseen ?? ""])].join(" ");
      expect(text, flow.id).not.toMatch(/advice|we will send|will be sent|automatically send|sends? (it )?automatically|Rebecca/i);
    }
  });
});

describe("progress", () => {
  const good = { lectual_hub: { version: HUB_VERSION, done: ["intake-leads", "matters-list"], hidden_card: true } };

  it("reads a good value", () => {
    expect(parseHubProgress(good)).toEqual({ done: ["intake-leads", "matters-list"], hiddenCard: true });
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["a string", "x"],
    ["no flag", {}],
    ["flag a string", { lectual_hub: "x" }],
    ["flag an array", { lectual_hub: [] }],
    ["another version", { lectual_hub: { version: 2, done: ["intake-leads"] } }],
    ["no version", { lectual_hub: { done: ["intake-leads"] } }],
  ])("reads %s as empty", (_n, meta) => {
    expect(parseHubProgress(meta)).toEqual(EMPTY_PROGRESS);
  });

  it("drops a done that is not an array, and bad or unknown entries", () => {
    expect(parseHubProgress({ lectual_hub: { version: 1, done: "intake-leads" } }).done).toEqual([]);
    expect(parseHubProgress({ lectual_hub: { version: 1, done: ["intake-leads", 4, null, "nope", "intake-leads", {}] } }).done).toEqual(["intake-leads"]);
    expect(parseHubProgress({ lectual_hub: { version: 1, done: [], hidden_card: "yes" } }).hiddenCard).toBe(false);
  });

  it("merges a flow id once", () => {
    const once = markFlowDone(EMPTY_PROGRESS, "intake-leads");
    expect(markFlowDone(once, "intake-leads").done).toEqual(["intake-leads"]);
    expect(markFlowDone(once, "nope").done).toEqual(["intake-leads"]);
    expect(isHubFlowId("intake-leads")).toBe(true);
    expect(isHubFlowId("x")).toBe(false);
  });

  it("builds the stored shape, with hidden_card only when true", () => {
    expect(buildHubMeta({ done: ["intake-leads"], hiddenCard: false })).toEqual({ version: 1, done: ["intake-leads"] });
    expect(buildHubMeta({ done: [], hiddenCard: true })).toEqual({ version: 1, done: [], hidden_card: true });
  });

  it("reset empties done and also clears the hidden card", () => {
    expect(resetProgress()).toEqual({ done: [], hiddenCard: false });
    expect(hideCard({ done: ["intake-leads"], hiddenCard: false })).toEqual({ done: ["intake-leads"], hiddenCard: true });
  });

  it("counts only flows the person can see", () => {
    const tracks = hubTracks(ctx("attorney"));
    const counts = trackCounts(tracks, ["intake-leads", "admin-setup", "staff-name"]);
    expect(counts.find((c) => c.id === "start")!.done).toBe(1);
    expect(overallCount(tracks, ["admin-setup", "intake-leads"]).done).toBe(0);
    const owner = hubTracks(ctx("owner"));
    expect(overallCount(owner, ["admin-setup"]).done).toBe(1);
    expect(overallCount(owner, []).total).toBe(owner.flatMap((t) => t.flows).length);
  });

  it("hides the Today card when everything visible is done, when hidden, and when nothing is visible", () => {
    const tracks = hubTracks(ctx("viewer"));
    const every = tracks.flatMap((t) => t.flows.map((f) => f.id));
    expect(shouldShowHubCard(tracks, EMPTY_PROGRESS)).toBe(true);
    expect(shouldShowHubCard(tracks, { done: every.slice(1), hiddenCard: false })).toBe(true);
    expect(shouldShowHubCard(tracks, { done: every, hiddenCard: false })).toBe(false);
    expect(shouldShowHubCard(tracks, { done: [], hiddenCard: true })).toBe(false);
    expect(shouldShowHubCard([], EMPTY_PROGRESS)).toBe(false);
  });

  it("local progress is the union of the server's and the browser's, ignoring unknown ids", () => {
    expect(mergeLocalDone(["intake-leads"], ["matters-list", "intake-leads", "bogus"])).toEqual(["intake-leads", "matters-list"]);
  });
});

describe("reset confirmation", () => {
  it("asks first and runs only when confirmed", () => {
    expect(stepReset("idle", "ask")).toEqual({ state: "confirming", run: false });
    expect(stepReset("confirming", "confirm")).toEqual({ state: "idle", run: true });
    expect(stepReset("confirming", "cancel")).toEqual({ state: "idle", run: false });
    expect(stepReset("idle", "confirm")).toEqual({ state: "idle", run: false });
  });
});

describe("record picking", () => {
  it("is three-state and takes the first row", () => {
    expect(pickFirstRecord({ ok: true, rows: [{ id: "a" }, { id: "b" }] })).toEqual({ status: "ok", id: "a" });
    expect(pickFirstRecord({ ok: true, rows: [] })).toEqual({ status: "none" });
    expect(pickFirstRecord({ ok: false })).toEqual({ status: "unavailable" });
  });
});

describe("the staff guide (roles outside the admin tier)", () => {
  const STAFF = ROLES.filter((r) => !["owner", "admin", "senior_admin"].includes(r));

  it.each(STAFF)("%s: name, own mailbox and the tour, nothing else", (role) => {
    expect(flowIds(ctx(role))).toEqual(["staff-name", "staff-mailbox", "staff-tour"]);
  });

  it.each(STAFF)("%s: no mailbox guide without the Mailboxes feature, or with the feature list unreadable", (role) => {
    expect(flowIds(ctx(role, ALL.filter((m) => m !== "mailbox")))).toEqual(["staff-name", "staff-tour"]);
    expect(flowIds(ctx(role, null))).toEqual(["staff-name", "staff-tour"]);
  });

  it.each(STAFF)("%s: no mailbox guide when this deployment can't connect Outlook (or it isn't said)", (role) => {
    expect(flowIds(ctx(role, ALL, true, false))).toEqual(["staff-name", "staff-tour"]);
    expect(flowIds({ role, modules: ALL, aiConfigured: true })).toEqual(["staff-name", "staff-tour"]);
  });

  it("the admin tier's hub doesn't depend on Outlook being connectable", () => {
    expect(flowIds(ctx("owner", ALL, true, false))).toEqual(flowIds(ctx("owner")));
  });

  it("the guide's words point at what is really on the page, and say nothing about signing drafts", async () => {
    const steps = visibleFlows(ctx("paralegal")).flatMap((f) => f.steps);
    const mailbox = steps.find((s) => s.id === "mailbox")!.body;
    expect(mailbox).toMatch(/Connect Outlook at the top of this page/);
    expect(mailbox).not.toMatch(/Under Mailboxes/);
    for (const s of steps) expect(s.body).not.toMatch(/sign(ed|s)? /i);
    const page = readFileSync("src/app/dashboard/settings/integrations/page.tsx", "utf8");
    expect(page).toContain("Connect {PROVIDER_LABEL[p]}");
  });

  it("points at the account menu (Your name, Show tips again) and the Integrations page", () => {
    const steps = visibleFlows(ctx("paralegal")).flatMap((f) => f.steps.map((s) => [f.id, s.path, s.target]));
    expect(steps).toEqual([
      ["staff-name", "/dashboard/", "account"],
      ["staff-mailbox", "/dashboard/settings/integrations/", "integrations-head"],
      ["staff-tour", "/dashboard/", "account"],
    ]);
  });

  it("the admin tier's hub is unchanged: the same flows, in the same order, as before the staff guide", () => {
    const BEFORE = [
      "intake-leads", "intake-board", "intake-lead", "intake-forms", "intake-reconcile",
      "consults-calendar", "consults-prep", "consults-proposal", "consults-accepted", "consults-meetings",
      "matters-list", "matters-page", "matters-files", "matters-updates",
      "approvals-queue", "approvals-agents", "approvals-copilot", "approvals-bell",
      "admin-setup", "admin-integrations", "admin-team", "admin-modules", "admin-firm",
    ];
    for (const role of ["owner", "admin", "senior_admin"]) expect(flowIds(ctx(role))).toEqual(BEFORE);
    expect(trackIds(ctx("owner"))).toEqual(["intake", "consults", "matters", "approvals", "admin"]);
  });

  it("old progress flags keep working and the new ids are recognised", () => {
    const meta = { lectual_hub: { version: HUB_VERSION, done: ["intake-leads", "staff-name", "nope", "staff-name"] } };
    expect(parseHubProgress(meta).done).toEqual(["intake-leads", "staff-name"]);
    expect(isHubFlowId("staff-tour")).toBe(true);
    expect(isHubFlowId("staff-anything")).toBe(false);
  });

  it("the Today card shows the staff guide's count and hides once all three are done", () => {
    const tracks = hubTracks(ctx("clerk"));
    expect(overallCount(tracks, []).total).toBe(3);
    expect(shouldShowHubCard(tracks, { done: ["staff-name", "staff-mailbox", "staff-tour"], hiddenCard: false })).toBe(false);
  });
});
