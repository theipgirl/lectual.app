import { describe, expect, it } from "vitest";
import { isValidSlug, slugCandidates, slugFromFirmName, SLUG_PATTERN } from "@/lib/intake-forms/slug";
import { checklistComplete, checklistRemaining, goLiveChecklist } from "@/lib/intake-forms/checklist";
import { intakePackages, publicPackages, type LibraryItem } from "@/lib/intake-forms/packages";
import { defaultIntakeConfig } from "@/lib/intake-forms/config";
import { intakeEmbedSnippet, intakePublicUrl } from "@/lib/intake-forms/links";

describe("slug", () => {
  it("mirrors 0079's crm_intake_form_slug_shape check exactly", () => {
    expect(SLUG_PATTERN.source).toBe("^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$");
  });

  it("derives a valid slug from any firm name", () => {
    expect(slugFromFirmName("Hartwell IP (demo)")).toBe("hartwell-ip-demo");
    expect(slugFromFirmName("Café & Co.")).toBe("cafe-and-co");
    expect(slugFromFirmName("RPB")).toBe("rpb");
    expect(slugFromFirmName("AB")).toBe("ab-intake");
    expect(slugFromFirmName("!!!")).toBe("firm-intake");
    const long = slugFromFirmName("The Very Long Name Intellectual Property Law Group of Southern Florida LLP");
    expect(long.length).toBeLessThanOrEqual(60);
    for (const s of ["Hartwell IP (demo)", "AB", "!!!", "a-", "x".repeat(200), "-- --"]) expect(isValidSlug(slugFromFirmName(s))).toBe(true);
  });

  it("offers numbered, then random, candidates that all pass the check", () => {
    const c = slugCandidates("hartwell-ip", () => "abc123");
    expect(c.slice(0, 3)).toEqual(["hartwell-ip", "hartwell-ip-2", "hartwell-ip-3"]);
    expect(c.at(-1)).toBe("hartwell-ip-abc123");
    const long = slugCandidates("x".repeat(60));
    expect(long.every(isValidSlug)).toBe(true);
    expect(long.every((s) => s.length <= 60)).toBe(true);
  });
});

describe("go-live checklist", () => {
  const ready = { ...defaultIntakeConfig(), fitText: "Founders filing a first US mark." };

  it("needs fit criteria, a closing message and a question", () => {
    const items = goLiveChecklist(defaultIntakeConfig(), { receivesReferrals: false, agreementSigned: false });
    expect(items.map((i) => i.key)).toEqual(["fit", "closing", "questions"]);
    expect(checklistRemaining(items)).toBe(1);
    expect(checklistComplete(goLiveChecklist(ready, { receivesReferrals: false, agreementSigned: false }))).toBe(true);
    expect(checklistComplete(goLiveChecklist({ ...ready, questions: [{ id: "a", text: "  ", required: true, pack: null, edited: true }] }, { receivesReferrals: false, agreementSigned: false }))).toBe(false);
    expect(checklistComplete(goLiveChecklist({ ...ready, closing: " " }, { receivesReferrals: false, agreementSigned: false }))).toBe(false);
  });

  it("adds office and the signed agreement only for referral firms", () => {
    const items = goLiveChecklist(ready, { receivesReferrals: true, agreementSigned: false });
    expect(items.map((i) => i.key)).toEqual(["fit", "closing", "questions", "office", "agreement"]);
    expect(checklistRemaining(items)).toBe(2);
    expect(checklistComplete(goLiveChecklist({ ...ready, office: "1 Main St" }, { receivesReferrals: true, agreementSigned: false }))).toBe(false);
    expect(checklistComplete(goLiveChecklist({ ...ready, office: "1 Main St" }, { receivesReferrals: true, agreementSigned: true }))).toBe(true);
  });
});

describe("fee packages", () => {
  const item = (o: Partial<LibraryItem>): LibraryItem => ({
    id: "11111111-1111-4111-8111-111111111111",
    label: "Starter",
    description: "One mark · one class",
    kind: "legal_fee",
    unit_amount_cents: 125000,
    active: true,
    sort_index: 0,
    ...o,
  });
  const items = [
    item({ id: "22222222-2222-4222-8222-222222222222", label: "Concierge", unit_amount_cents: 325050, sort_index: 1 }),
    item({}),
    item({ id: "33333333-3333-4333-8333-333333333333", label: "USPTO fee", kind: "government_fee" }),
    item({ id: "44444444-4444-4444-8444-444444444444", label: "Old", active: false }),
  ];

  it("offers active legal-fee items only, in library order, priced exactly", () => {
    const rows = intakePackages(items, ["22222222-2222-4222-8222-222222222222"]);
    expect(rows.map((r) => [r.name, r.price, r.visible])).toEqual([
      ["Starter", "$1,250.00", false],
      ["Concierge", "$3,250.50", true],
    ]);
  });

  it("shows prospects visible items only, without ids, and nothing when fees are off", () => {
    const cfg = { feesOn: true, visiblePackageIds: ["22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"] };
    expect(publicPackages(items, cfg)).toEqual([{ name: "Concierge", price: "$3,250.50", includes: "One mark · one class" }]);
    expect(publicPackages(items, { ...cfg, feesOn: false })).toEqual([]);
  });
});

describe("links", () => {
  it("builds the direct link and the embed snippet", () => {
    expect(intakePublicUrl("https://app.lectual.com/", "hartwell-ip")).toBe("https://app.lectual.com/i/hartwell-ip");
    expect(intakeEmbedSnippet("https://app.lectual.com", "hartwell-ip")).toBe(
      '<script src="https://app.lectual.com/embed.js" data-intake="hartwell-ip" async></script>',
    );
  });
});
