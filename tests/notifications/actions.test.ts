import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const markRead = vi.fn();
const markAllRead = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/notifications", () => ({ markRead: (...a: unknown[]) => markRead(...a), markAllRead: (...a: unknown[]) => markAllRead(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const ID = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  markRead.mockReset().mockResolvedValue(undefined);
  markAllRead.mockReset().mockResolvedValue(undefined);
  revalidatePath.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("notification actions (F5)", () => {
  it("marks one read once and revalidates the dashboard layout", async () => {
    const { markNotificationRead } = await import("@/app/dashboard/notifications/actions");
    expect(await markNotificationRead(ID)).toEqual({ ok: true });
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith(ID);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("refuses an id that is not a uuid with a sentence and does not touch the database", async () => {
    const { markNotificationRead } = await import("@/app/dashboard/notifications/actions");
    for (const bad of ["", "abc", "1; drop table", ID + "x", undefined as unknown as string]) {
      const out = await markNotificationRead(bad);
      expect(out).toEqual({ error: expect.stringMatching(/isn't valid/) });
    }
    expect(markRead).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("marks all read once and revalidates", async () => {
    const { markAllNotificationsRead } = await import("@/app/dashboard/notifications/actions");
    expect(await markAllNotificationsRead()).toEqual({ ok: true });
    expect(markAllRead).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
  });

  it("returns a friendly error, never database text, when a write throws", async () => {
    const { markNotificationRead, markAllNotificationsRead } = await import("@/app/dashboard/notifications/actions");
    markRead.mockRejectedValue(new Error('permission denied for table "crm_notification"'));
    markAllRead.mockRejectedValue(new Error("connection refused 10.0.0.5"));
    const one = await markNotificationRead(ID);
    const all = await markAllNotificationsRead();
    for (const out of [one, all]) {
      expect(out).toHaveProperty("error");
      expect(JSON.stringify(out)).not.toMatch(/crm_notification|permission denied|10\.0\.0\.5/);
    }
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("stays on the scoped client and takes no user or org from the caller", () => {
    const src = readFileSync("src/app/dashboard/notifications/actions.ts", "utf8");
    expect(src).not.toMatch(/db\/admin|getAdminClient/);
    expect(src).not.toMatch(/user_?id|org_?id|orgId|userId/i);
    expect(src).toMatch(/export async function markNotificationRead\(id: string\)/);
    expect(src).toMatch(/export async function markAllNotificationsRead\(\)/);
  });
});
