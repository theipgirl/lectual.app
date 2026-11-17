import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { firstUsers, ownItems, type FirstUsersInput, type OwnConnection, type PersonIn } from "@/lib/setup/first-users";
import { loadFirstUsers, loadYourSetup, type FirstUsersReaders } from "@/lib/setup/first-users-load";
import { readColleagueRows, isMissingOwnerFunction, type ColleagueMailbox, type ColleagueMailboxes } from "@/lib/mailbox/colleague-rows";
import { TeamAccountsView, YourSetupView } from "@/components/setup/TeamAccounts";
import { ADMIN_TIER, ALL_DONE, OTHER_ROLES, bad, ok } from "./helpers";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); } }));

// People come from the directory: these are test data, not names in code.
const ME = "u-me";
const PEOPLE: PersonIn[] = [
  { userId: ME, name: "Taylor Owner", role: "owner" },
  { userId: "u-c", name: "Caitlyn Ross", role: "paralegal" },
  { userId: "u-r", name: "Rebecca Ames", role: "attorney" },
  { userId: "u-n", name: "Rayn Cole", role: "law_clerk" },
];
const MAIL_ON = ok(["mailbox"]);
const own = (over: Partial<OwnConnection> = {}): OwnConnection => ({ id: "c-me", userId: ME, scope: "personal", provider: "microsoft", status: "active", email: "taylor@firm.test", canDraft: true, ...over });
const theirs = (userId: string, over: Partial<ColleagueMailbox> = {}): ColleagueMailbox => ({ id: `c-${userId}`, userId, scope: "personal", provider: "microsoft", email: `${userId}@firm.test`, status: "active", ...over });

function input(over: Partial<FirstUsersInput> = {}): FirstUsersInput {
  return { viewerId: ME, viewerRole: "owner", members: ok(PEOPLE), modules: MAIL_ON, own: ok([own()]), colleagues: { kind: "ok", rows: [own() && theirs(ME, { id: "c-me", email: "taylor@firm.test" }), theirs("u-c"), theirs("u-n", { status: "reauth" })] }, ...over };
}
const rowOf = (r: ReturnType<typeof firstUsers>, id: string) => {
  if (r.status !== "ok") throw new Error("not ok");
  return r.rows.find((x) => x.userId === id)!;
};
const item = (r: ReturnType<typeof firstUsers>, id: string, which: "outlook" | "drafts") => rowOf(r, id).items.find((i) => i.id === which)!;

describe("every member appears from the directory, with their role (acceptance 6)", () => {
  it("one row per member, role words from roleLabel, the viewer marked", () => {
    const r = firstUsers(input());
    expect(r.status === "ok" && r.rows.map((x) => x.name)).toEqual(["Taylor Owner", "Caitlyn Ross", "Rebecca Ames", "Rayn Cole"]);
    expect(rowOf(r, "u-n").roleLabel).toBe("Law clerk");
    expect(rowOf(r, ME).isYou).toBe(true);
    expect(rowOf(r, "u-c").isYou).toBe(false);
  });

  it("a member list that cannot be read is couldn't check, not an empty team", () => {
    expect(firstUsers(input({ members: bad }))).toEqual({ status: "couldnt-check" });
  });
});

describe("the viewer's own row (their own scoped read)", () => {
  it("connected with a draft scope is done on both items", () => {
    const r = firstUsers(input());
    expect(item(r, ME, "outlook")).toMatchObject({ status: "done", text: "Connected as taylor@firm.test." });
    expect(item(r, ME, "drafts").status).toBe("done");
  });

  it("connected without the draft scope: Outlook done, drafts to do with a link", () => {
    const r = firstUsers(input({ own: ok([own({ canDraft: false })]) }));
    expect(item(r, ME, "outlook").status).toBe("done");
    expect(item(r, ME, "drafts")).toMatchObject({ status: "to-do", href: "/dashboard/settings/integrations/" });
  });

  it.each([["reauth", "needs reconnecting"], ["error", "needs reconnecting"], ["revoked", "disconnected"]])("a %s connection is to do, never done", (status, words) => {
    const r = firstUsers(input({ own: ok([own({ status })]) }));
    expect(item(r, ME, "outlook").status).toBe("to-do");
    expect(item(r, ME, "outlook").text).toContain(words);
    expect(item(r, ME, "drafts").status).toBe("to-do");
  });

  it("no connection and Gmail only are to do", () => {
    expect(item(firstUsers(input({ own: ok([]) })), ME, "outlook").text).toBe("No Outlook mailbox connected yet.");
    expect(item(firstUsers(input({ own: ok([own({ provider: "google" })]) })), ME, "outlook").text).toContain("Gmail");
  });

  it("a failed own read is couldn't check, never done and never to do", () => {
    const r = firstUsers(input({ own: bad }));
    expect(rowOf(r, ME).items.map((i) => i.status)).toEqual(["couldnt-check", "couldnt-check"]);
  });

  it("a firm-shared mailbox is not the person's own", () => {
    const r = firstUsers(input({ own: ok([own({ scope: "firm", userId: null })]) }));
    expect(item(r, ME, "outlook").status).toBe("to-do");
  });
});

describe("the Mailboxes feature gate (the checklist fails closed)", () => {
  it("off: every item is to do, with the platform-voice sentence and a link to Features for the admin tier", () => {
    const r = firstUsers(input({ modules: ok([]) }));
    for (const p of PEOPLE) {
      expect(rowOf(r, p.userId).items.map((i) => i.status)).toEqual(["to-do", "to-do"]);
      expect(item(r, p.userId, "outlook").text).toBe("Mailboxes aren't switched on for your firm yet. Lectual turns them on.");
      expect(item(r, p.userId, "outlook").href).toBe("/dashboard/settings/modules/");
    }
  });

  it("an unreadable module list is couldn't check, not 'off'", () => {
    const r = firstUsers(input({ modules: bad }));
    expect(rowOf(r, "u-c").items.map((i) => i.status)).toEqual(["couldnt-check", "couldnt-check"]);
  });
});

describe("a colleague's mailbox: owner through 0108, everyone else 'Only <name> can see this' (acceptance 7)", () => {
  it("an owner sees each colleague's address and status from the function", () => {
    const r = firstUsers(input());
    expect(item(r, "u-c", "outlook")).toMatchObject({ status: "done", text: "Connected as u-c@firm.test." });
    expect(item(r, "u-n", "outlook").status).toBe("to-do");
    expect(item(r, "u-n", "outlook").text).toContain("needs reconnecting");
    expect(item(r, "u-r", "outlook")).toMatchObject({ status: "to-do", text: "No Outlook mailbox connected yet." });
  });

  it("a colleague's draft permission is not in the function's six columns, so it reads Only <first name> can see this", () => {
    const r = firstUsers(input());
    expect(item(r, "u-c", "drafts")).toMatchObject({ status: "private", text: "Only Caitlyn can see this" });
    expect(item(r, "u-r", "drafts").status).toBe("to-do"); // nothing connected, so nothing to see
  });

  it.each([...ADMIN_TIER.filter((r) => r !== "owner"), ...OTHER_ROLES])("%s never gets the function's rows: another member's mailbox is Only <name> can see this, never 'not connected'", (role) => {
    const r = firstUsers(input({ viewerRole: role, colleagues: { kind: "not-asked" } }));
    for (const id of ["u-c", "u-r", "u-n"]) {
      expect(rowOf(r, id).items.map((i) => i.status)).toEqual(["private", "private"]);
      expect(item(r, id, "outlook").text).toMatch(/^Only (Caitlyn|Rebecca|Rayn) can see this$/);
      expect(JSON.stringify(rowOf(r, id))).not.toMatch(/not connected|No Outlook/i);
    }
    expect(item(r, ME, "outlook").status).toBe("done"); // their own row still shows its real state
  });

  it("before 0108 is applied an owner sees the same wording, and nothing fails (7b)", () => {
    const r = firstUsers(input({ colleagues: { kind: "not-switched-on" } }));
    expect(item(r, "u-c", "outlook")).toMatchObject({ status: "private", text: "Only Caitlyn can see this" });
    expect(item(r, ME, "outlook").status).toBe("done");
  });

  it("a refused or failed call is couldn't check, never not connected (7a)", () => {
    const r = firstUsers(input({ colleagues: { kind: "unavailable" } }));
    expect(rowOf(r, "u-c").items.map((i) => i.status)).toEqual(["couldnt-check", "couldnt-check"]);
  });

  it("an empty answer that leaves out the owner's own visible mailbox is not trusted (no active firm): couldn't check, not 'not connected'", () => {
    const r = firstUsers(input({ colleagues: { kind: "ok", rows: [] } }));
    expect(item(r, "u-c", "outlook").status).toBe("couldnt-check");
  });

  it("a member with no readable first name (an address as name) gets a neutral sentence, never the address", () => {
    const r = firstUsers(input({ viewerRole: "admin", colleagues: { kind: "not-asked" }, members: ok([{ userId: "u-x", name: "x@firm.test", role: "clerk" }]) }));
    expect(item(r, "u-x", "outlook").text).toBe("Only they can see this");
  });
});

describe("what reaches the page from 0108's answer (acceptance 7)", () => {
  const raw = { id: "c1", user_id: "u1", scope: "personal", provider: "microsoft", email: "a@b.co", status: "active" };

  it("keeps exactly six fields, even if the function ever returned more", () => {
    const leaky = { ...raw, access_token_enc: "T", refresh_token_enc: "R", scopes: ["Mail.Read"], sync_cursor: "cur", last_error: "boom", token_expires_at: "x", body: "mail" };
    const r = readColleagueRows([leaky], null);
    expect(r.kind).toBe("ok");
    const row = (r as { rows: object[] }).rows[0];
    expect(Object.keys(row).sort()).toEqual(["email", "id", "provider", "scope", "status", "userId"]);
    const json = JSON.stringify(r);
    for (const needle of ["T\"", "R\"", "Mail.Read", "cur", "boom", "mail"]) expect(json).not.toContain(`"${needle.replace('"', "")}"`);
    expect(json).not.toContain("access_token");
  });

  it("a missing function is by CODE only: 42883 and PGRST202 mean not switched on; any other error, or text alone, is unavailable", () => {
    expect(readColleagueRows(null, { code: "42883" })).toEqual({ kind: "not-switched-on" });
    expect(readColleagueRows(null, { code: "PGRST202" })).toEqual({ kind: "not-switched-on" });
    expect(readColleagueRows(null, { code: "42501" })).toEqual({ kind: "unavailable" });
    expect(readColleagueRows(null, { message: "function does not exist" } as never)).toEqual({ kind: "unavailable" });
    expect(isMissingOwnerFunction(undefined)).toBe(false);
  });

  it("an answer that is not a list, or a row that is malformed, is unavailable (never an empty list)", () => {
    expect(readColleagueRows(null, null)).toEqual({ kind: "unavailable" });
    expect(readColleagueRows({}, null)).toEqual({ kind: "unavailable" });
    expect(readColleagueRows([{ ...raw, status: "weird" }], null)).toEqual({ kind: "unavailable" });
    expect(readColleagueRows([{ ...raw, email: 5 }], null)).toEqual({ kind: "unavailable" });
    expect(readColleagueRows([null], null)).toEqual({ kind: "unavailable" });
  });

  it("zero rows is a real, empty answer", () => {
    expect(readColleagueRows([], null)).toEqual({ kind: "ok", rows: [] });
  });
});

describe("the loader", () => {
  function readers(over: Partial<FirstUsersReaders> = {}): FirstUsersReaders & { colleagues: ReturnType<typeof vi.fn> } {
    return {
      listMembers: vi.fn(async () => PEOPLE),
      readModules: vi.fn(async () => ({ ok: true as const, modules: ["mailbox"] })),
      listOwn: vi.fn(async () => [own()]),
      colleagues: vi.fn(async (): Promise<ColleagueMailboxes> => ({ kind: "ok", rows: [theirs(ME, { id: "c-me" })] })),
      ...over,
    } as never;
  }

  it("asks the owner function for the viewer's role, and only when Mailboxes is on", async () => {
    const r = readers();
    await loadFirstUsers({ id: ME, role: "owner" }, r);
    expect(r.colleagues).toHaveBeenCalledWith("owner");
    const off = readers({ readModules: vi.fn(async () => ({ ok: true as const, modules: [] })) });
    await loadFirstUsers({ id: ME, role: "owner" }, off);
    expect(off.colleagues).not.toHaveBeenCalled();
    expect(off.listOwn).not.toHaveBeenCalled();
  });

  it("never throws: a throwing member read, module read, own read or colleague call each become couldn't check", async () => {
    const boom = vi.fn(async () => { throw new Error("SECRET-detail"); });
    expect(await loadFirstUsers({ id: ME, role: "owner" }, readers({ listMembers: boom }))).toEqual({ status: "couldnt-check" });
    const m = await loadFirstUsers({ id: ME, role: "owner" }, readers({ readModules: boom as never }));
    expect(m.status === "ok" && m.rows[1].items.map((i) => i.status)).toEqual(["couldnt-check", "couldnt-check"]);
    const o = await loadFirstUsers({ id: ME, role: "owner" }, readers({ listOwn: boom as never }));
    expect(o.status === "ok" && o.rows[0].items[0].status).toBe("couldnt-check");
    const c = await loadFirstUsers({ id: ME, role: "owner" }, readers({ colleagues: boom as never }));
    expect(c.status === "ok" && c.rows[1].items[0].status).toBe("couldnt-check");
    expect(JSON.stringify([m, o, c])).not.toContain("SECRET");
  });

  it("Your setup reads only the person's own connections, and not at all when Mailboxes is off or unreadable", async () => {
    const listOwn = vi.fn(async () => [own()]);
    const items = await loadYourSetup({ id: ME, role: "paralegal" }, ["mailbox"], { listOwn });
    expect(items.map((i) => i.status)).toEqual(["done", "done"]);
    const off = await loadYourSetup({ id: ME, role: "paralegal" }, [], { listOwn });
    expect(off.map((i) => i.status)).toEqual(["to-do", "to-do"]);
    expect(off[0].href).toBeUndefined(); // Features is the admin tier's page
    const unreadable = await loadYourSetup({ id: ME, role: "paralegal" }, null, { listOwn });
    expect(unreadable.map((i) => i.status)).toEqual(["couldnt-check", "couldnt-check"]);
    expect(listOwn).toHaveBeenCalledTimes(1);
  });
});

describe("the sections as drawn", () => {
  const html = (data: Parameters<typeof TeamAccountsView>[0]["data"]) => renderToStaticMarkup(<TeamAccountsView data={data} />).replaceAll("&#x27;", "'");

  it("draws each person, role, You, each item's own pill and the Only-<name> wording", () => {
    const out = html(firstUsers(input({ viewerRole: "admin", colleagues: { kind: "not-asked" } })));
    expect(out).toContain("Team accounts");
    expect(out.match(/data-user=/g)).toHaveLength(4);
    expect(out).toContain("Law clerk");
    expect(out).toContain(">You<");
    expect(out).toContain("Only Rayn can see this");
    expect(out).toContain(">Private<");
    expect(out).toContain(">Done<");
  });

  it("a failed directory read says so and draws no rows", () => {
    const out = html({ status: "couldnt-check" });
    expect(out).toContain("Team accounts couldn't be checked right now");
    expect(out).not.toContain("data-user=");
  });

  it("an owner's view carries addresses and status words but no token, scope or cursor vocabulary", () => {
    const out = html(firstUsers(input()));
    expect(out).toContain("Connected as u-c@firm.test.");
    expect(out).toContain("needs reconnecting");
    expect(out).not.toMatch(/token|sync_cursor|last_error|Mail\.Read/i);
  });

  it("Your setup draws the person's own two items", () => {
    const out = renderToStaticMarkup(<YourSetupView items={ownItems({ viewerId: ME, viewerRole: "clerk", modules: MAIL_ON, own: ok([]) })} />);
    expect(out).toContain("Your setup");
    expect(out).toContain("No Outlook mailbox connected yet.");
    expect(out).toContain(">To do<");
  });
});

describe("the Setup page (acceptance 5)", () => {
  const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
  async function page(session: unknown, accounts: unknown = { status: "ok", rows: [] }) {
    vi.resetModules();
    const loadFirstUsers = vi.fn(async () => accounts);
    const loadSetupState = vi.fn(async () => ALL_DONE);
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => session) }));
    vi.doMock("@/lib/setup/load", () => ({ loadSetupState }));
    vi.doMock("@/lib/setup/first-users-load", () => ({ loadFirstUsers }));
    const { default: Page } = await import("../../src/app/dashboard/settings/setup/page");
    return { Page, loadFirstUsers, loadSetupState };
  }

  it.each([...OTHER_ROLES, null, "not-a-role"])("%j gets not-found and the accounts are never read", async (role) => {
    const { Page, loadFirstUsers, loadSetupState } = await page({ kind: "ok", role, user: { id: "u" } });
    await expect(Page()).rejects.toThrow(NOT_FOUND);
    expect(loadFirstUsers).not.toHaveBeenCalled();
    expect(loadSetupState).not.toHaveBeenCalled();
  });

  it("signed out and no access get not-found", async () => {
    for (const s of [{ kind: "signed-out", redirectTo: "/sign-in/" }, { kind: "no-access" }]) {
      const { Page, loadFirstUsers } = await page(s);
      await expect(Page()).rejects.toThrow(NOT_FOUND);
      expect(loadFirstUsers).not.toHaveBeenCalled();
    }
  });

  it.each([...ADMIN_TIER])("%s sees Team accounts, and the loader gets the session's own id and role", async (role) => {
    const { Page, loadFirstUsers } = await page({ kind: "ok", role, user: { id: "u-me" } }, firstUsers(input({ viewerRole: role, colleagues: { kind: "not-asked" } })));
    const out = renderToStaticMarkup(await Page());
    expect(out).toContain('data-section="team-accounts"');
    expect(loadFirstUsers).toHaveBeenCalledWith({ id: "u-me", role });
  });
});
