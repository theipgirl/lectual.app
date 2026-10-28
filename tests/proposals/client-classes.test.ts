import { describe, it, expect } from "vitest";
import {
  DEFAULT_CLIENT_ENTRY_PROMPT,
  MAX_CLIENT_TEXT_CHARS,
  addedClassCount,
  buildEffectiveContent,
  clientAddMax,
  cleanClientText,
  missingClientText,
  parseClientClassInput,
  quoteWithClientClasses,
} from "@/lib/proposals/client-classes";
import { defaultSelection, isFixedOffer, lockedSelectionIds, normalizeSelection, quoteProposal } from "@/lib/proposals/pricing";
import { validateContent } from "@/lib/proposals/validate";
import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

const pick = (...ids: string[]) => Object.fromEntries(ids.map((id) => [id, true]));

/** Essential-shaped: $1,950 base, 1 class included, $825 per extra class, $350 USPTO; one brand, one firm class. */
function essential(): ProposalContent {
  const c = sevetri();
  c.pricing = { ...c.pricing, package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, gov_per_class_cents: 35_000 };
  c.names = [{ ...c.names[0], classes: [c.names[0].classes[0]] }];
  return c;
}

/** The real case: a design mark, Essential, three OPEN classes, and room for the client to add 2 more. */
function openEssential(): ProposalContent {
  const c = essential();
  c.names = [
    {
      ...c.names[0],
      marks: [{ ...c.names[0].marks[1], preselected: true }],
      classes: [
        { id: "o1", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true },
        { id: "o2", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true },
        { id: "o3", label: DEFAULT_CLIENT_ENTRY_PROMPT, preselected: true, client_entry: true },
      ],
      client_add: { max: 2 },
    },
  ];
  return c;
}

describe("cleanClientText", () => {
  it("trims, collapses whitespace, strips control characters and angle brackets", () => {
    expect(cleanClientText("  Handmade   candles \n and\tsoaps ")).toBe("Handmade candles and soaps");
    expect(cleanClientText("<b>Bakery</b> goods")).toBe("bBakery/b goods");
    expect(cleanClientText("nul\u0000bell\u0007del\u007fsep end")).toBe("nul bell del sep end");
  });
  it("caps at 200 characters", () => {
    expect(cleanClientText("a".repeat(500))).toHaveLength(MAX_CLIENT_TEXT_CHARS);
    expect(cleanClientText(` ${"a".repeat(MAX_CLIENT_TEXT_CHARS)} `)).toHaveLength(MAX_CLIENT_TEXT_CHARS);
  });
  it("never leaves half of a surrogate pair at the cut", () => {
    const out = cleanClientText(`${"a".repeat(199)}😀more`);
    expect(out).toBe("a".repeat(199));
  });
  it("anything not a string is empty", () => {
    for (const bad of [1, null, undefined, {}, ["x"]]) expect(cleanClientText(bad)).toBe("");
  });
});

describe("clientAddMax", () => {
  it("is an integer 0..10, anything else 0", () => {
    expect(clientAddMax({ client_add: { max: 3 } })).toBe(3);
    expect(clientAddMax({ client_add: { max: 99 } })).toBe(10);
    expect(clientAddMax({ client_add: { max: -1 } })).toBe(0);
    expect(clientAddMax({ client_add: { max: 1.5 } })).toBe(0);
    expect(clientAddMax({ client_add: "x" as unknown as { max: number } })).toBe(0);
    expect(clientAddMax({})).toBe(0);
  });
});

describe("parseClientClassInput: the server is the authority", () => {
  const c = openEssential();

  it("keeps entries for open classes only, cleaned", () => {
    const got = parseClientClassInput(c, { entries: { o1: "  Candles  ", o2: "<i>Soap</i>", nope: "x", "p-c1": "y" } });
    expect(got.entries).toEqual({ o1: "Candles", o2: "iSoap/i" });
  });

  it("drops entries for classes that are not open", () => {
    expect(parseClientClassInput(essential(), { entries: { "p-c1": "Bakery" } }).entries).toEqual({});
  });

  it("drops adds for unknown names, for names without client_add, and past max", () => {
    const two = sevetri();
    two.names[0].client_add = { max: 2 };
    const got = parseClientClassInput(two, {
      added: {
        p: [{ text: "One", on: true }, { text: "Two", on: false }, { text: "Three", on: true }],
        t: [{ text: "Not allowed", on: true }],
        nope: [{ text: "x", on: true }],
      },
    });
    expect(got.added).toEqual({ p: [{ text: "One", on: true }, { text: "Two", on: false }] });
  });

  it("drops an unticked add with no text, keeps a ticked empty one (so the caller refuses it)", () => {
    const got = parseClientClassInput(c, { added: { p: [{ text: "  ", on: false }, { text: "", on: true }] } });
    expect(got.added).toEqual({ p: [{ text: "", on: true }] });
  });

  it("only `on: true` ticks; a plain string (the Sprint 28 shape) reads as ticked", () => {
    const got = parseClientClassInput(c, { added: { p: [{ text: "A", on: "true" }, "B"] } });
    expect(got.added).toEqual({ p: [{ text: "A", on: false }, { text: "B", on: true }] });
  });

  it("garbage is nothing", () => {
    for (const raw of [undefined, null, "x", [], 1, { entries: "x", added: [] }, { added: { p: "x" } }]) {
      expect(parseClientClassInput(c, raw)).toEqual({ entries: {}, added: {} });
    }
  });
});

describe("buildEffectiveContent", () => {
  it("open classes take the client's words as their label and keep the prompt and marker", () => {
    const { content } = buildEffectiveContent(openEssential(), pick("p-logo", "o1"), { entries: { o1: "Candles" }, added: {} });
    expect(content.names[0].classes[0]).toEqual({ id: "o1", label: "Candles", preselected: true, client_entry: true, prompt: DEFAULT_CLIENT_ENTRY_PROMPT });
    expect(content.names[0].classes[1].label).toBe("");
    expect(content.names[0].classes[1].prompt).toBe(DEFAULT_CLIENT_ENTRY_PROMPT);
  });

  it("added classes get server ids ca-<nameId>-<n>, ticked as the client left them", () => {
    const { content, selection } = buildEffectiveContent(openEssential(), pick("p-logo", "o1"), {
      entries: {},
      added: { p: [{ text: "Online store", on: true }, { text: "Workshops", on: false }] },
    });
    const extra = content.names[0].classes.slice(3);
    expect(extra).toEqual([
      { id: "ca-p-1", label: "Online store", preselected: true, client_added: true },
      { id: "ca-p-2", label: "Workshops", preselected: false, client_added: true },
    ]);
    expect(selection["ca-p-1"]).toBe(true);
    expect(selection["ca-p-2"]).toBe(false);
    expect(addedClassCount(content)).toBe(2);
    expect(addedClassCount(content, selection)).toBe(1);
  });

  it("never reuses an id and never changes the content passed in", () => {
    const c = openEssential();
    c.names[0].classes.push({ id: "ca-p-1", label: "taken", preselected: false });
    const { content } = buildEffectiveContent(c, {}, { entries: {}, added: { p: [{ text: "x", on: true }] } });
    const ids = content.names[0].classes.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(c.names[0].classes).toHaveLength(4);
    expect(c.names[0].classes[0].label).toBe(DEFAULT_CLIENT_ENTRY_PROMPT);
  });

  it("missingClientText names ticked open/added classes with no words, never unticked ones", () => {
    const { content, selection } = buildEffectiveContent(openEssential(), pick("p-logo", "o1", "o2"), {
      entries: { o1: "Candles", o3: "" },
      added: { p: [{ text: "", on: true }, { text: "", on: false }] },
    });
    expect(missingClientText(content, selection)).toEqual(["o2", "ca-p-1"]);
  });
});

describe("quoteWithClientClasses: one price path", () => {
  it("open classes are priced exactly like firm classes", () => {
    const sel = pick("p-logo", "o1", "o2", "o3");
    const priced = quoteWithClientClasses(openEssential(), sel, { entries: { o1: "a", o2: "b", o3: "c" }, added: {} });
    const firm = essential();
    firm.names[0].marks = [{ ...firm.names[0].marks[1], preselected: true }];
    firm.names[0].classes = ["o1", "o2", "o3"].map((id) => ({ id, label: id, preselected: true }));
    const engine = quoteProposal(firm, sel);
    if (!priced.ok) throw new Error("priced");
    expect(priced.quote.legal_total_cents).toBe(engine.legal_total_cents);
    expect(priced.quote.gov_total_cents).toBe(engine.gov_total_cents);
    // Essential: $1,950 + 2 x $825 = $3,600; USPTO 3 x $350.
    expect(priced.quote.legal_total_cents).toBe(360_000);
    expect(priced.quote.gov_total_cents).toBe(105_000);
    expect(priced.quote.names[0].classes.map((x) => x.label)).toEqual(["a", "b", "c"]);
    expect(priced.missing).toEqual([]);
  });

  it("an added class counts: one more class past the included count, one more USPTO fee", () => {
    const sel = pick("p-logo", "o1");
    const without = quoteWithClientClasses(openEssential(), sel, { entries: { o1: "a" }, added: {} });
    const withOne = quoteWithClientClasses(openEssential(), sel, { entries: { o1: "a" }, added: { p: [{ text: "Online store", on: true }] } });
    const unticked = quoteWithClientClasses(openEssential(), sel, { entries: { o1: "a" }, added: { p: [{ text: "Online store", on: false }] } });
    if (!without.ok || !withOne.ok || !unticked.ok) throw new Error("priced");
    expect(withOne.quote.legal_total_cents - without.quote.legal_total_cents).toBe(82_500);
    expect(withOne.quote.gov_total_cents - without.quote.gov_total_cents).toBe(35_000);
    expect(unticked.quote).toEqual(without.quote);
  });

  it("repair only when asked for, and a repaired empty open class is reported missing", () => {
    const bare = pick("p-logo");
    const page = quoteWithClientClasses(openEssential(), bare, { entries: {}, added: {} });
    const server = quoteWithClientClasses(openEssential(), bare, { entries: {}, added: {} }, { repair: true });
    expect(page.ok && page.quote.legal_total_cents).toBe(0);
    if (!server.ok) throw new Error("priced");
    expect(server.selection.o1).toBe(true);
    expect(server.missing).toEqual(["o1"]);
  });
});

describe("the $0 lock and fixed offers count client classes", () => {
  it("a proposal with an open class or client_add room is never a fixed offer", () => {
    const one = essential();
    one.names[0].marks = [one.names[0].marks[0]];
    expect(isFixedOffer(one)).toBe(true);
    const open = structuredClone(one);
    open.names[0].classes[0].client_entry = true;
    expect(isFixedOffer(open)).toBe(false);
    const room = structuredClone(one);
    room.names[0].client_add = { max: 1 };
    expect(isFixedOffer(room)).toBe(false);
    // max 0 lets the client add nothing: still fixed.
    const zero = structuredClone(one);
    zero.names[0].client_add = { max: 0 };
    expect(isFixedOffer(zero)).toBe(true);
    // So the defaults follow `preselected`, not "everything ticked".
    open.names[0].classes[0].preselected = false;
    expect(defaultSelection(open)[open.names[0].classes[0].id]).toBe(false);
    expect(normalizeSelection(open, {})[open.names[0].classes[0].id]).toBe(false);
  });

  it("with an added class ticked, the firm's last class is no longer held; the added one is", () => {
    const c = openEssential();
    c.names[0].classes = [c.names[0].classes[0]];
    const sel = pick("p-logo", "o1");
    const alone = quoteWithClientClasses(c, sel, { entries: { o1: "a" }, added: {} });
    if (!alone.ok) throw new Error("priced");
    expect([...lockedSelectionIds(alone.content, alone.selection)].sort()).toEqual(["o1", "p-logo"]);
    const two = quoteWithClientClasses(c, { ...sel, o1: false }, { entries: { o1: "a" }, added: { p: [{ text: "b", on: true }] } });
    if (!two.ok) throw new Error("priced");
    expect([...lockedSelectionIds(two.content, two.selection)].sort()).toEqual(["ca-p-1", "p-logo"]);
  });
});

describe("validateContent: open classes and client_add", () => {
  it("accepts the real case: three open classes and room for two more", () => {
    expect(validateContent(openEssential()).filter((i) => i.level === "error")).toEqual([]);
  });

  it("client_add.max must be an integer 0..10", () => {
    for (const max of [-1, 11, 1.5, "2"]) {
      const c = openEssential();
      (c.names[0] as unknown as { client_add: unknown }).client_add = { max };
      expect(validateContent(c).some((i) => i.path === "names[0].client_add" && i.level === "error")).toBe(true);
    }
    const ok = openEssential();
    ok.names[0].client_add = { max: 0 };
    expect(validateContent(ok).some((i) => i.path === "names[0].client_add")).toBe(false);
  });

  it("listed classes plus what the client may add stay within 10", () => {
    const c = openEssential();
    c.names[0].client_add = { max: 8 };
    expect(validateContent(c).some((i) => i.path === "names[0].client_add" && /10 or fewer/.test(i.message))).toBe(true);
    c.names[0].client_add = { max: 10 };
    c.names[0].classes = [c.names[0].classes[0]];
    expect(validateContent(c).some((i) => i.path === "names[0].client_add")).toBe(true);
    c.names[0].client_add = { max: 9 };
    expect(validateContent(c).some((i) => i.path === "names[0].client_add")).toBe(false);
  });

  it("still at most 3 firm-listed classes", () => {
    const c = openEssential();
    c.names[0].client_add = { max: 1 };
    c.names[0].classes.push({ id: "o4", label: "Four", preselected: false, client_entry: true });
    expect(validateContent(c).some((i) => i.path === "names[0].classes" && i.level === "error")).toBe(true);
  });

  it("an open class needs its question, and client_entry is true or absent", () => {
    const c = openEssential();
    c.names[0].classes[0].label = " ";
    (c.names[0].classes[1] as unknown as { client_entry: unknown }).client_entry = "yes";
    const issues = validateContent(c);
    expect(issues).toContainEqual(expect.objectContaining({ path: "names[0].classes[0].label", message: "Write the question the client answers for this class." }));
    expect(issues.some((i) => i.path === "names[0].classes[1].client_entry")).toBe(true);
  });
});
