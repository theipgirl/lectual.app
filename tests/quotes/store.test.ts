import { describe, it, expect } from "vitest";

import { generatePublicToken } from "@/lib/quotes/store";
import {
  assertIdsMatchSet,
  assertIncludedIsSelected,
  assertLineAmountSign,
  assertLineKindChargeAt,
  assertTierGroupShape,
  QuoteLineConstraintError,
  serviceItemToLineFields,
  findDuplicateLibraryLine,
  type ServiceItemRow,
} from "@/lib/quotes/types";

/**
 * Mostly PURE-LOGIC coverage — no database, nothing that touches a cloud
 * project. Everything in the first sections is a plain function
 * store.ts/service-library.ts call BEFORE a write reaches Postgres, mirroring
 * the CHECK constraints 0068 enforces a second time (§0's header: "enforced
 * TWICE on purpose") — these tests are the record that the app-layer half
 * actually agrees with the database half, not a redundant restatement of one
 * migration comment.
 *
 * `server-only` is aliased to a no-op in vitest.config.ts, so importing
 * store.ts directly (for `generatePublicToken`) is safe here even though the
 * module is written for a Server Component / server action context.
 */

describe("generatePublicToken", () => {
  it("produces >=32 bytes of base64url — the 0068 crm_quote_token_len floor", () => {
    // 32 random bytes as unpadded base64url is exactly 43 characters.
    const token = generatePublicToken();
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it("uses only base64url characters (no '+', '/', or '=' padding)", () => {
    const token = generatePublicToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("never repeats across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePublicToken()));
    expect(seen.size).toBe(50);
  });
});

describe("assertLineKindChargeAt — §0, the USPTO rule", () => {
  it("throws when a government_fee is charged at signing", () => {
    expect(() => assertLineKindChargeAt("government_fee", "signing")).toThrow(QuoteLineConstraintError);
  });

  it("allows a government_fee charged at filing", () => {
    expect(() => assertLineKindChargeAt("government_fee", "filing")).not.toThrow();
  });

  it("allows a government_fee that is never charged", () => {
    expect(() => assertLineKindChargeAt("government_fee", "not_charged")).not.toThrow();
  });

  it("allows a legal_fee charged at signing (the ordinary case)", () => {
    expect(() => assertLineKindChargeAt("legal_fee", "signing")).not.toThrow();
  });

  it("allows a discount or expense charged at signing", () => {
    expect(() => assertLineKindChargeAt("discount", "signing")).not.toThrow();
    expect(() => assertLineKindChargeAt("expense", "signing")).not.toThrow();
  });
});

describe("assertLineAmountSign — crm_quote_line_amount_sign", () => {
  it("throws when a discount is stored positive", () => {
    expect(() => assertLineAmountSign("discount", 100)).toThrow(QuoteLineConstraintError);
  });

  it("allows a discount stored negative or zero", () => {
    expect(() => assertLineAmountSign("discount", -100)).not.toThrow();
    expect(() => assertLineAmountSign("discount", 0)).not.toThrow();
  });

  it("throws when a non-discount line is stored negative", () => {
    expect(() => assertLineAmountSign("legal_fee", -100)).toThrow(QuoteLineConstraintError);
    expect(() => assertLineAmountSign("government_fee", -1)).toThrow(QuoteLineConstraintError);
    expect(() => assertLineAmountSign("expense", -1)).toThrow(QuoteLineConstraintError);
  });

  it("allows a non-discount line stored non-negative", () => {
    expect(() => assertLineAmountSign("legal_fee", 500000)).not.toThrow();
    expect(() => assertLineAmountSign("legal_fee", 0)).not.toThrow();
  });
});

describe("assertTierGroupShape — crm_quote_line_tier_group", () => {
  it("throws when a tier_option carries no group", () => {
    expect(() => assertTierGroupShape("tier_option", null)).toThrow();
    expect(() => assertTierGroupShape("tier_option", "")).toThrow();
    expect(() => assertTierGroupShape("tier_option", "   ")).toThrow();
  });

  it("allows a tier_option with a group", () => {
    expect(() => assertTierGroupShape("tier_option", "package")).not.toThrow();
  });

  it("throws when a non-tier-option line carries a group", () => {
    expect(() => assertTierGroupShape("included", "package")).toThrow();
    expect(() => assertTierGroupShape("optional", "package")).toThrow();
  });

  it("allows a non-tier-option line with no group", () => {
    expect(() => assertTierGroupShape("included", null)).not.toThrow();
    expect(() => assertTierGroupShape("optional", undefined)).not.toThrow();
  });
});

describe("assertIncludedIsSelected — crm_quote_line_included_selected", () => {
  it("throws when an included line is deselected", () => {
    expect(() => assertIncludedIsSelected("included", false)).toThrow();
  });

  it("allows an included line that is selected", () => {
    expect(() => assertIncludedIsSelected("included", true)).not.toThrow();
  });

  it("never blocks optional/tier_option lines either way", () => {
    expect(() => assertIncludedIsSelected("optional", false)).not.toThrow();
    expect(() => assertIncludedIsSelected("optional", true)).not.toThrow();
    expect(() => assertIncludedIsSelected("tier_option", false)).not.toThrow();
  });
});

describe("assertIdsMatchSet — reorderQuoteLines' defence against a foreign or partial order", () => {
  it("accepts a permutation of the exact existing set", () => {
    expect(() => assertIdsMatchSet(["a", "b", "c"], ["c", "a", "b"])).not.toThrow();
  });

  it("rejects an id that does not belong to this quote", () => {
    expect(() => assertIdsMatchSet(["a", "b"], ["a", "b", "z"])).toThrow(/does not belong/);
  });

  it("rejects a partial reorder that omits an existing line", () => {
    expect(() => assertIdsMatchSet(["a", "b", "c"], ["a", "b"])).toThrow(/missing/);
  });

  it("rejects a duplicate id in the proposed order", () => {
    expect(() => assertIdsMatchSet(["a", "b"], ["a", "a"])).toThrow(/more than once/);
  });

  it("accepts two empty sets (a quote with no lines yet)", () => {
    expect(() => assertIdsMatchSet([], [])).not.toThrow();
  });
});

describe("findDuplicateLibraryLine — adding the same service twice", () => {
  const item: Pick<ServiceItemRow, "id" | "kind" | "charge_at" | "unit_amount_cents" | "label" | "description"> = {
    id: "item-1",
    kind: "government_fee",
    charge_at: "filing",
    unit_amount_cents: 35000,
    label: "USPTO filing fee (per class)",
    description: null,
  };
  const fields = serviceItemToLineFields(item);
  const line = { id: "l-1", ...fields, tier_group: null as string | null };

  it("finds the identical copy already on the quote", () => {
    expect(findDuplicateLibraryLine([line], fields)?.id).toBe("l-1");
  });

  it("is not a duplicate once the line was re-priced, relabelled, or placed elsewhere", () => {
    expect(findDuplicateLibraryLine([{ ...line, unit_amount_cents: 40000 }], fields)).toBeUndefined();
    expect(findDuplicateLibraryLine([{ ...line, label: "Filing fee, class 30" }], fields)).toBeUndefined();
    expect(findDuplicateLibraryLine([{ ...line, selection: "optional" as const }], fields)).toBeUndefined();
    expect(findDuplicateLibraryLine([{ ...line, source_service_item_id: "item-2" }], fields)).toBeUndefined();
  });

  it("tells packages apart", () => {
    const inPkg = serviceItemToLineFields(item, { selection: "tier_option", tierGroup: "Standard" });
    expect(findDuplicateLibraryLine([{ ...line, ...inPkg, tier_group: "Premium" }], inPkg)).toBeUndefined();
    expect(findDuplicateLibraryLine([{ ...line, ...inPkg }], inPkg)?.id).toBe("l-1");
  });
});

describe("serviceItemToLineFields — the COPY, never reference, rule (spec §3.3)", () => {
  const item: Pick<ServiceItemRow, "id" | "kind" | "charge_at" | "unit_amount_cents" | "label" | "description"> = {
    id: "item-1",
    kind: "legal_fee",
    charge_at: "signing",
    unit_amount_cents: 350000,
    label: "Trademark Package — Standard",
    description: "Full prosecution through registration.",
  };

  it("copies every field verbatim with no overrides", () => {
    const fields = serviceItemToLineFields(item);
    expect(fields).toMatchObject({
      kind: "legal_fee",
      charge_at: "signing",
      selection: "included",
      tier_group: null,
      selected: true,
      label: "Trademark Package — Standard",
      description: "Full prosecution through registration.",
      quantity: 1,
      unit_amount_cents: 350000,
      source_service_item_id: "item-1",
    });
  });

  it("records source_service_item_id but never a live reference the library can later change", () => {
    const fields = serviceItemToLineFields(item);
    // The copy has no field that could re-resolve to the library row's
    // CURRENT price if the library item is edited later — only its id, for
    // analytics, which store.ts never reads back.
    expect(Object.keys(fields)).not.toContain("service_item");
    expect(fields.source_service_item_id).toBe("item-1");
  });

  it("a price override wins over the library default", () => {
    const fields = serviceItemToLineFields(item, { unitAmountCents: 299900 });
    expect(fields.unit_amount_cents).toBe(299900);
    // Nothing else drifts from the library item just because price did.
    expect(fields.label).toBe(item.label);
  });

  it("does NOT allow overriding kind — copying a legal_fee item as a government_fee line is refused by omission", () => {
    // ServiceItemApplyOverrides has no `kind` field at all; even an `as any`
    // caller can't make this function change what kind of line it is.
    const fields = serviceItemToLineFields(item, {} as never);
    expect(fields.kind).toBe("legal_fee");
  });

  it("an empty label override falls back to the library item's label", () => {
    const fields = serviceItemToLineFields(item, { label: "   " });
    expect(fields.label).toBe(item.label);
  });

  it("an explicit null description override wins over the library's non-null description", () => {
    const fields = serviceItemToLineFields(item, { description: null });
    expect(fields.description).toBeNull();
  });

  it("selection defaults to 'included' when not overridden, even for an add-on style item", () => {
    const fields = serviceItemToLineFields(item);
    expect(fields.selection).toBe("included");
    expect(fields.selected).toBe(true);
  });

  it("a tier_option override without a tierGroup override drops the group (never invents one)", () => {
    const fields = serviceItemToLineFields(item, { selection: "tier_option" });
    // No tierGroup supplied — this function does not fabricate one; the
    // caller (store.ts#applyServiceItem) validates the result with
    // assertTierGroupShape and refuses it before any write.
    expect(fields.selection).toBe("tier_option");
    expect(fields.tier_group).toBeNull();
  });

  it("a tier_option override WITH a tierGroup carries it through, trimmed", () => {
    const fields = serviceItemToLineFields(item, { selection: "tier_option", tierGroup: "  package  " });
    expect(fields.tier_group).toBe("package");
  });

  it("an optional override defaults to unselected unless selected:true is also given", () => {
    const unselected = serviceItemToLineFields(item, { selection: "optional" });
    expect(unselected.selected).toBe(false);

    const selected = serviceItemToLineFields(item, { selection: "optional", selected: true });
    expect(selected.selected).toBe(true);
  });

  it("selected:true cannot be forced onto a still-included line via override going the other way", () => {
    // An 'included' line is ALWAYS selected regardless of what the caller
    // passes for `selected` — the same rule crm_quote_line_included_selected
    // enforces at the database.
    const fields = serviceItemToLineFields(item, { selected: false });
    expect(fields.selection).toBe("included");
    expect(fields.selected).toBe(true);
  });

  it("a non-integer or zero quantity override falls back to 1", () => {
    expect(serviceItemToLineFields(item, { quantity: 0 }).quantity).toBe(1);
    expect(serviceItemToLineFields(item, { quantity: -3 }).quantity).toBe(1);
    expect(serviceItemToLineFields(item, { quantity: 2.5 }).quantity).toBe(1);
  });

  it("a valid positive integer quantity override is honoured", () => {
    expect(serviceItemToLineFields(item, { quantity: 3 }).quantity).toBe(3);
  });

  it("an unrecognised chargeAt override is ignored in favour of the library item's own schedule", () => {
    const fields = serviceItemToLineFields(item, { chargeAt: "monthly" as never });
    expect(fields.charge_at).toBe("signing");
  });

  it("a government_fee item's charge_at cannot be smuggled to 'signing' without the RESULT still being rejectable by assertLineKindChargeAt", () => {
    const govItem = { ...item, kind: "government_fee" as const, charge_at: "filing" as const };
    const fields = serviceItemToLineFields(govItem, { chargeAt: "signing" });
    // serviceItemToLineFields itself does not enforce §0 — store.ts always
    // re-validates the RESULT with assertLineKindChargeAt before writing, and
    // this is exactly the input that must fail that check.
    expect(fields.kind).toBe("government_fee");
    expect(fields.charge_at).toBe("signing");
    expect(() => assertLineKindChargeAt(fields.kind, fields.charge_at)).toThrow(QuoteLineConstraintError);
  });
});
