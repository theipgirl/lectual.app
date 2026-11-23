import { describe, expect, it, vi } from "vitest";
import { CF, customFixture, members, OWNER_PERMS, params, renderOwnerSheet, renderReadOnly, rows, TODAY } from "./columns-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }), usePathname: () => "/dashboard/review/", useSearchParams: () => new URLSearchParams() }));

/**
 * Review fix (Nov 23): SheetView and SheetEdit enforce their OWN `canSeeCustomMoney` prop. Handed an UNFILTERED custom state that holds a
 * Money value, with `canSeeCustomMoney={false}`, neither the rendered HTML nor the props handed down (the client table's included) carry the
 * Money field's id, its label or its amount. `canSeeMoney` is false so the built-in Legal Fee (also $1,250.00 in the fixture) isn't drawn.
 */
const QUOTE = `cf:${CF.quote}`;
const props = (el: unknown) => JSON.stringify(el, (_k, v) => (typeof v === "function" ? "[fn]" : typeof v === "symbol" ? String(v) : v));
const leaks = (s: string) => [QUOTE, CF.quote, "Quoted fee", "125000", "1250.00", "1,250"].filter((x) => s.includes(x));
/** The props also hold the raw review rows, whose built-in fee facts ("$1,250.00", owner-only and not this change's) the page decides; the
 * custom amount is checked by its field id, label, cents and editor value. */
const leaksInProps = (s: string) => [QUOTE, CF.quote, "Quoted fee", "125000", "1250.00"].filter((x) => s.includes(x));

describe("the sheet components drop custom money themselves", () => {
  it("SheetView (read-only): HTML and props", async () => {
    expect(customFixture.status === "ok" && customFixture.values.some((v) => v.cents === 125000)).toBe(true);
    expect(leaks(await renderReadOnly({ canSeeMoney: false, canSeeCustomMoney: false, custom: customFixture }))).toEqual([]);
    const { SheetView } = await import("@/components/review/SheetView");
    const el = SheetView({ rows, owner: false, today: TODAY, members, canWrite: false, params, canSeeMoney: false, canSeeCustomMoney: false, custom: customFixture } as never);
    expect(leaksInProps(props(el))).toEqual([]);
  });

  it("SheetEdit (owner table): HTML and props, editors and field meta included", async () => {
    expect(leaks(await renderOwnerSheet({ canSeeMoney: false, canSeeCustomMoney: false, custom: customFixture, perms: { ...OWNER_PERMS, writeCustom: true } }))).toEqual([]);
    const { SheetEdit } = await import("@/components/review/SheetEdit");
    const el = SheetEdit({ rows, perms: { ...OWNER_PERMS, writeCustom: true }, owner: true, today: TODAY, members, canWrite: true, params, canSeeMoney: false, canSeeCustomMoney: false, custom: customFixture } as never);
    expect(leaksInProps(props(el))).toEqual([]);
  });

  it("SheetView delegating to SheetEdit hands it the cleaned state", async () => {
    const { SheetView } = await import("@/components/review/SheetView");
    const el = SheetView({ rows, owner: true, sheetEdit: { perms: OWNER_PERMS }, today: TODAY, members, canWrite: true, params, canSeeMoney: false, canSeeCustomMoney: false, custom: customFixture } as never);
    expect(leaksInProps(props(el))).toEqual([]);
  });

  it("control: with canSeeCustomMoney the same state does carry the Money field (the check above is not vacuous)", async () => {
    const html = await renderOwnerSheet({ canSeeMoney: false, canSeeCustomMoney: true, custom: customFixture, perms: { ...OWNER_PERMS, writeCustom: true } });
    expect(html).toContain("Quoted fee");
    const { SheetEdit } = await import("@/components/review/SheetEdit");
    const el = SheetEdit({ rows, perms: { ...OWNER_PERMS, writeCustom: true }, owner: true, today: TODAY, members, canWrite: true, params, canSeeMoney: false, canSeeCustomMoney: true, custom: customFixture } as never);
    expect(leaksInProps(props(el))).toEqual(expect.arrayContaining([QUOTE, "Quoted fee", "1250.00"]));
  });
});
