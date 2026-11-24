import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { DeckLists } from "@/components/deck/DeckLists";
import { DeckSide } from "@/components/deck/DeckSide";

const decided = { status: "ok" as const, rows: [{ id: "a", href: "/dashboard/queue/a/", title: "Maya", sub: "Approved 7:12 AM · draft in Outlook", pill: "Approved", tone: "ok" as const }] };
const handed = { status: "ok" as const, rows: [{ id: "h", href: "/dashboard/queue/h/", title: "Priya", sub: "To Caitlyn 7:24 AM", pill: "With Caitlyn", tone: "line" as const, back: false }] };
const later = { status: "ok" as const, rows: [] };

describe("DeckLists", () => {
  it("has neither the sub-line nor the hand-off footer caption", () => {
    const html = renderToStaticMarkup(<DeckLists active="decided" needCount={1} decided={{ status: "ok", rows: [] }} handed={{ status: "ok", rows: [] }} later={{ status: "ok", rows: [] }} />);
    expect(html).not.toContain("What you decided today and what you handed");
    expect(html).not.toContain("Handing off changes whose deck");
    expect(html).toContain("Nothing handed off.");
  });
  it("marks the active chip and shows counts", () => {
    const html = renderToStaticMarkup(<DeckLists active="decided" needCount={3} decided={decided} handed={handed} later={later} />);
    expect(html).toMatch(/aria-current="page"[^>]*>Decided · 1</);
    expect(html).toContain("Needs your yes · 3");
    expect(html).toContain("Handed off · 1");
    expect(html).toContain("Later · 0");
    expect(html).toContain("← Back to today");
    expect(html).not.toMatch(/https?:|sha256/);
  });
  it("a failed source is a dash and its own sentence, and the others still draw", () => {
    const html = renderToStaticMarkup(<DeckLists active="handed" needCount={null} decided={decided} handed={{ status: "unavailable" }} later={{ status: "not-set-up" }} />);
    expect(html).toContain("Handed off · —");
    expect(html).toContain("Needs your yes · —");
    expect(html).toContain("Hand-offs couldn&#x27;t be loaded");
    expect(html).toContain("Maya");
  });
  it("a queue that is not connected says so on each card", () => {
    const html = renderToStaticMarkup(<DeckLists active="handed" needCount={null} decided={{ status: "not-connected" }} handed={{ status: "not-connected" }} later={{ status: "not-connected" }} />);
    expect(html).toContain("Not connected");
    expect(html).not.toContain("couldn&#x27;t be loaded");
  });
  it("an empty source is a dashed empty card", () => {
    const html = renderToStaticMarkup(<DeckLists active="decided" needCount={0} decided={{ status: "ok", rows: [] }} handed={{ status: "ok", rows: [] }} later={later} />);
    expect(html.match(/dk-empty-card/g)?.length).toBe(2);
  });
});

describe("DeckSide sections", () => {
  const row = { id: "x", title: "T", href: "/x", current: false, decided: false };
  it("draws Needs your yes, Later and Decided today, each with its count", () => {
    const html = renderToStaticMarkup(<DeckSide rows={[row, { ...row, id: "d", decided: true }]} later={{ status: "ok", rows: [{ ...row, id: "l", chip: "2:00 PM", timeChip: true }] }} />);
    for (const w of ["Needs your yes", "Later", "Decided today", "2:00 PM"]) expect(html).toContain(w);
    expect(html).toContain('aria-label="See all decided today"');
    expect(html).toContain('aria-label="See all later"');
    expect(html.match(/>See all</g)?.length).toBe(2);
    expect(html).toContain("dk-chip--time");
  });
  it("a Later that could not be read says so rather than showing none", () => {
    const html = renderToStaticMarkup(<DeckSide rows={[row]} later={{ status: "unavailable" }} />);
    expect(html).toContain("Can&#x27;t show Later right now.");
    expect(html).not.toContain("Nothing put off.");
  });
  it("empty sections are dashed empty cards, not loose text", () => {
    const html = renderToStaticMarkup(<DeckSide rows={[]} later={{ status: "ok", rows: [] }} />);
    expect(html.match(/dk-empty-card/g)?.length).toBe(3);
  });
  it("a failed decided read is a dash and the sentence, with no 0 and no full-list link", () => {
    const html = renderToStaticMarkup(<DeckSide rows={[row]} decidedFailed />);
    expect(html).toContain("Can&#x27;t show this list right now.");
    expect(html).not.toContain("Nothing decided yet");
    expect(html).not.toContain("See all decided today");
  });
  it("without a later prop (technician-less callers) the Later section is not drawn", () => {
    expect(renderToStaticMarkup(<DeckSide rows={[row]} />)).not.toContain("Nothing put off.");
  });
});
