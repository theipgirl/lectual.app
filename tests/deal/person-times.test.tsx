import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { DEFAULT_DEAL_TIMES } from "@/lib/deal/times";
import {
  DEAL_TIMES_KEY,
  dealTimeOptions,
  parseDealTimes,
  requestDealTimesDialog,
  SHOW_DEAL_TIMES_EVENT,
  validateDealTimes,
  withDealTimes,
} from "@/lib/deal/person-times";
import { DEAL_TIMES_APART, DEAL_TIMES_INVALID, DEAL_TIMES_STEP } from "@/lib/ui/words";

const DEFAULTS = [...DEFAULT_DEAL_TIMES];

describe("validateDealTimes", () => {
  it("accepts two times exactly 120 minutes apart", () => {
    expect(validateDealTimes("07:00", "09:00")).toEqual({ ok: true, times: ["07:00", "09:00"] });
  });
  it("refuses 119 minutes apart (and a 5-minute-step 115)", () => {
    expect(validateDealTimes("07:00", "08:59")).toEqual({ ok: false, error: DEAL_TIMES_STEP });
    expect(validateDealTimes("07:00", "08:55")).toEqual({ ok: false, error: DEAL_TIMES_APART });
  });
  it("refuses minutes that are not a multiple of 5 (:07)", () => {
    expect(validateDealTimes("07:07", "14:00")).toEqual({ ok: false, error: DEAL_TIMES_STEP });
    expect(validateDealTimes("07:00", "14:03")).toEqual({ ok: false, error: DEAL_TIMES_STEP });
  });
  it("accepts 23:55 as the later time and 00:00 as the earlier", () => {
    expect(validateDealTimes("07:00", "23:55")).toEqual({ ok: true, times: ["07:00", "23:55"] });
    expect(validateDealTimes("02:00", "23:55")).toEqual({ ok: true, times: ["02:00", "23:55"] });
    expect(validateDealTimes("00:00", "02:00")).toEqual({ ok: true, times: ["00:00", "02:00"] });
  });
  it("sorts reversed input", () => {
    expect(validateDealTimes("14:00", "07:00")).toEqual({ ok: true, times: ["07:00", "14:00"] });
  });
  it("refuses duplicates as too close", () => {
    expect(validateDealTimes("07:00", "07:00")).toEqual({ ok: false, error: DEAL_TIMES_APART });
  });
  it("holds across midnight too: the later deal and the next day's first are 2 hours apart at least", () => {
    expect(validateDealTimes("23:00", "00:30")).toEqual({ ok: false, error: DEAL_TIMES_APART });
    expect(validateDealTimes("00:00", "23:55")).toEqual({ ok: false, error: DEAL_TIMES_APART });
    expect(validateDealTimes("00:00", "22:00")).toEqual({ ok: true, times: ["00:00", "22:00"] }); // exactly 120 the other way
    expect(validateDealTimes("00:00", "22:05")).toEqual({ ok: false, error: DEAL_TIMES_APART });
    expect(validateDealTimes("23:00", "01:00")).toEqual({ ok: true, times: ["01:00", "23:00"] });
    expect(validateDealTimes("22:00", "23:55")).toEqual({ ok: false, error: DEAL_TIMES_APART });
  });
  it.each([
    [null, "07:00"],
    ["07:00", undefined],
    [7, 14],
    ["7:00", "14:00"],
    ["24:00", "14:00"],
    ["07:60", "14:00"],
    ["07:00 AM", "14:00"],
    ["", ""],
    ["07:00", { a: 1 }],
  ])("refuses junk input %j / %j with the fixed sentence", (a, b) => {
    expect(validateDealTimes(a, b)).toEqual({ ok: false, error: DEAL_TIMES_INVALID });
  });
});

describe("parseDealTimes", () => {
  it("reads the stored pair", () => {
    expect(parseDealTimes({ [DEAL_TIMES_KEY]: { v: 1, times: ["08:30", "15:45"] } })).toEqual(["08:30", "15:45"]);
  });
  it("sorts a stored reversed pair", () => {
    expect(parseDealTimes({ [DEAL_TIMES_KEY]: { v: 1, times: ["15:45", "08:30"] } })).toEqual(["08:30", "15:45"]);
  });
  it.each([
    ["no metadata", null],
    ["not an object", "x"],
    ["missing key", {}],
    ["wrong version", { [DEAL_TIMES_KEY]: { v: 2, times: ["08:30", "15:45"] } }],
    ["no version", { [DEAL_TIMES_KEY]: { times: ["08:30", "15:45"] } }],
    ["not an object value", { [DEAL_TIMES_KEY]: "08:30" }],
    ["three times", { [DEAL_TIMES_KEY]: { v: 1, times: ["08:30", "15:45", "17:00"] } }],
    ["one time", { [DEAL_TIMES_KEY]: { v: 1, times: ["08:30"] } }],
    ["times not an array", { [DEAL_TIMES_KEY]: { v: 1, times: "08:30,15:45" } }],
    ["junk times", { [DEAL_TIMES_KEY]: { v: 1, times: ["soon", "later"] } }],
    ["too close", { [DEAL_TIMES_KEY]: { v: 1, times: ["08:00", "09:00"] } }],
    ["off-step minutes", { [DEAL_TIMES_KEY]: { v: 1, times: ["08:07", "15:00"] } }],
  ])("falls back to the defaults for %s", (_l, meta) => {
    expect(parseDealTimes(meta)).toEqual(DEFAULTS);
  });
  it("hands back a copy, never the shared default array", () => {
    const a = parseDealTimes(null);
    a[0] = "01:00";
    expect(DEFAULT_DEAL_TIMES[0]).toBe("07:00");
  });
});

describe("withDealTimes", () => {
  it("sets only its own key and keeps every other one", () => {
    const meta = {
      full_name: "Rebecca Pearl",
      lectual_tour: { version: 1, outcome: "finished" },
      lectual_hub: { version: 1, done: ["a"] },
      lectual_view_preview: { org1: "as:owner" },
    };
    const out = withDealTimes(meta, ["08:00", "16:00"]);
    expect(out).toEqual({ ...meta, [DEAL_TIMES_KEY]: { v: 1, times: ["08:00", "16:00"] } });
    expect(meta).not.toHaveProperty(DEAL_TIMES_KEY);
  });
  it("replaces an earlier value and tolerates missing metadata", () => {
    expect(withDealTimes({ [DEAL_TIMES_KEY]: { v: 1, times: ["07:00", "14:00"] } }, ["09:00", "17:00"])).toEqual({ [DEAL_TIMES_KEY]: { v: 1, times: ["09:00", "17:00"] } });
    expect(withDealTimes(null, ["09:00", "17:00"])).toEqual({ [DEAL_TIMES_KEY]: { v: 1, times: ["09:00", "17:00"] } });
  });
  it("round-trips through parseDealTimes", () => {
    expect(parseDealTimes(withDealTimes({}, ["06:15", "13:40"]))).toEqual(["06:15", "13:40"]);
  });
});

describe("dealTimeOptions", () => {
  it("lists every 5 minutes with 12-hour labels", () => {
    const o = dealTimeOptions();
    expect(o).toHaveLength(288);
    expect(o[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(o.find((x) => x.value === "07:00")?.label).toBe("7:00 AM");
    expect(o.at(-1)).toEqual({ value: "23:55", label: "11:55 PM" });
  });
});

describe("requestDealTimesDialog", () => {
  it("dispatches the event with the opener", () => {
    const seen: Event[] = [];
    const opener = { focus: () => {} };
    requestDealTimesDialog({ dispatchEvent: (e) => (seen.push(e), true) }, opener);
    expect(seen[0].type).toBe(SHOW_DEAL_TIMES_EVENT);
    expect((seen[0] as CustomEvent).detail.opener).toBe(opener);
  });
});

type User = { user_metadata?: Record<string, unknown> } | null;
async function loadAction(opts: { user: User; updateError?: { message: string } | null; getUserError?: boolean }) {
  vi.resetModules();
  const updateUser = vi.fn(async () => ({ error: opts.updateError ?? null }));
  vi.doMock("@/lib/db/scoped-client", () => ({
    getScopedClient: vi.fn(async () => ({
      auth: { getUser: vi.fn(async () => ({ data: { user: opts.user }, error: opts.getUserError ? { message: "boom" } : null })), updateUser },
    })),
  }));
  const { saveDealTimesAction } = await import("@/lib/account/deal-times-actions");
  return { saveDealTimesAction, updateUser };
}
const signedIn = { user_metadata: { lectual_tour: { version: 1 }, lectual_hub: { version: 1, done: ["a"] }, full_name: "Rebecca" } };

beforeEach(() => vi.resetModules());

describe("saveDealTimesAction", () => {
  it("merges into the existing metadata and stores the sorted pair", async () => {
    const { saveDealTimesAction, updateUser } = await loadAction({ user: signedIn });
    const res = await saveDealTimesAction({ times: ["15:00", "08:00"] });
    expect(res).toEqual({ ok: true, times: ["08:00", "15:00"] });
    expect(updateUser).toHaveBeenCalledWith({ data: { ...signedIn.user_metadata, [DEAL_TIMES_KEY]: { v: 1, times: ["08:00", "15:00"] } } });
  });
  it("refuses signed-out, writing nothing", async () => {
    const { saveDealTimesAction, updateUser } = await loadAction({ user: null });
    expect(await saveDealTimesAction({ times: ["08:00", "15:00"] })).toEqual({ ok: false, error: "You are not signed in." });
    expect(updateUser).not.toHaveBeenCalled();
  });
  it.each([
    ["no input", null],
    ["no times", {}],
    ["one time", { times: ["08:00"] }],
    ["three times", { times: ["08:00", "12:00", "16:00"] }],
    ["too close", { times: ["08:00", "09:55"] }],
    ["off-step", { times: ["08:02", "15:00"] }],
    ["junk", { times: ["a", "b"] }],
  ])("validates on the server: refuses %s and writes nothing", async (_l, input) => {
    const { saveDealTimesAction, updateUser } = await loadAction({ user: signedIn });
    expect((await saveDealTimesAction(input)).ok).toBe(false);
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("a failing updateUser or getUser gives a fixed sentence with no provider text", async () => {
    const failed = await loadAction({ user: signedIn, updateError: { message: "SECRET provider detail" } });
    const res = await failed.saveDealTimesAction({ times: ["08:00", "15:00"] });
    expect(res).toEqual({ ok: false, error: "We couldn't save your deal times. Try again." });
    expect(JSON.stringify(res)).not.toContain("SECRET");
    const noUser = await loadAction({ user: signedIn, getUserError: true });
    expect((await noUser.saveDealTimesAction({ times: ["08:00", "15:00"] })).ok).toBe(false);
  });
  it("has no user or org parameter and never imports the admin client", () => {
    const src = fs.readFileSync("src/lib/account/deal-times-actions.ts", "utf8");
    expect(src).toMatch(/saveDealTimesAction\(input: unknown\)/);
    expect(src).not.toMatch(/@\/lib\/db\/admin|getAdminClient\(/);
  });
});

describe("the dialog and where it is opened", () => {
  it("draws two selects in 5-minute steps, the firm zone line, Save and Cancel", async () => {
    const { DealTimesDialogView } = await import("@/components/deck/DealTimesDialog");
    const html = renderToStaticMarkup(
      <DealTimesDialogView first="07:00" second="14:00" zoneLabel="Eastern Time (New York)" error={null} saving={false} onFirst={() => {}} onSecond={() => {}} onSave={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html.match(/<select/g)).toHaveLength(2);
    expect(html.match(/<option/g)).toHaveLength(576);
    expect(html).toContain('<option value="07:00" selected="">7:00 AM</option>');
    expect(html).toContain("Eastern Time (New York). Changes only your own deck.");
    expect(html).toContain("Save");
    expect(html).toContain("Cancel");
  });
  it("shows an inline error as an alert", async () => {
    const { DealTimesDialogView } = await import("@/components/deck/DealTimesDialog");
    const html = renderToStaticMarkup(
      <DealTimesDialogView first="07:00" second="08:00" zoneLabel="Eastern Time (New York)" error={DEAL_TIMES_APART} saving={false} onFirst={() => {}} onSecond={() => {}} onSave={() => {}} onClose={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain(DEAL_TIMES_APART);
  });
  it("is mounted only in the owner view of the layout, and opened from the menu and the deck header", () => {
    const layout = fs.readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout).toMatch(/shell\.variant === "owner" && <DealTimesDialog/);
    expect(fs.readFileSync("src/components/shell/AccountMenu.tsx", "utf8")).toMatch(/requestDealTimesDialog\(window/);
    expect(fs.readFileSync("src/components/deck/DeckFrame.tsx", "utf8")).toMatch(/<DealTimesButton/);
  });
  it("the account menu row is in the owner variant only", async () => {
    const { AccountMenu } = await import("@/components/shell/AccountMenu");
    const props = { initials: "RP", name: "Rebecca", email: "r@x.example", role: "owner", firmName: "Firm", activeOrgId: "o", switchableFirms: [] };
    expect(renderToStaticMarkup(<AccountMenu {...props} variant="owner" />)).toContain("Deal times");
    expect(renderToStaticMarkup(<AccountMenu {...props} />)).not.toContain("Deal times");
  });
});

describe("readers use the person's times", () => {
  it("every owner-view reader of dealFor / dealtAt passes the person's times", () => {
    expect(fs.readFileSync("src/app/dashboard/queue/deck/deck-view.tsx", "utf8")).toMatch(/dealFor\(now, tz, myTimes\)[\s\S]*dealtAt\(now, tz, myTimes\)/);
    const summary = fs.readFileSync("src/lib/queue/deck-summary.ts", "utf8");
    expect(summary).toMatch(/dealFor\(now, tz, dealTimes\)/);
    expect(summary).toMatch(/dealtAt\(now, tz, dealTimes\)/);
    expect(fs.readFileSync("src/components/today/OwnerToday.tsx", "utf8")).toMatch(/parseDealTimes\(metadata\)/);
    const actions = fs.readFileSync("src/app/dashboard/queue/deck/actions.ts", "utf8");
    expect(actions).toMatch(/readMyDealTimes\(\)/);
    expect(actions).not.toMatch(/dealFor\(new Date\(\), await getFirmTimeZone\(\)\)/);
  });
  it("Later's 'until' is the next deal of the actor's own times", async () => {
    const { dealFor } = await import("@/lib/deal/times");
    const now = new Date("2026-11-10T14:30:00Z"); // 9:30 AM Eastern
    expect(dealFor(now, "America/New_York", ["10:00", "16:30"]).next.label).toBe("10:00 AM");
    expect(dealFor(now, "America/New_York", ["08:00", "16:30"]).next.label).toBe("4:30 PM");
    expect(dealFor(now, "America/New_York").next.label).toBe("2:00 PM");
  });
});
