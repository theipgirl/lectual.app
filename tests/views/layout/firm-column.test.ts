import { describe, expect, it, vi } from "vitest";
import { changeFirmColumn, type FirmColumnDeps } from "@/lib/views/layout/firm-column";
import * as W from "@/lib/ui/words";

const ID = "0a1b2c3d-0000-4000-8000-00000000f001";
const KEY = `cf:${ID}`;

function deps(over: Partial<FirmColumnDeps> = {}) {
  return {
    owner: vi.fn(async () => true),
    readStamp: vi.fn(async () => "2026-11-20T10:00:00+00:00"),
    update: vi.fn(async () => ({ saved: true })),
    clearLabels: vi.fn(async () => true),
    ...over,
  } as FirmColumnDeps & { owner: ReturnType<typeof vi.fn>; readStamp: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; clearLabels: ReturnType<typeof vi.fn> };
}

describe("a firm column's own menu: rename the field, edit its choices, archive it", () => {
  it("not an owner: refused before any read or write", async () => {
    for (const owner of [async () => false, async () => Promise.reject(new Error("x"))]) {
      const d = deps({ owner });
      expect(await changeFirmColumn(d, { op: "rename", key: KEY, label: "X" })).toEqual({ ok: false, error: W.COLUMNS_NO_PERMISSION });
      expect(d.readStamp).not.toHaveBeenCalled();
      expect(d.update).not.toHaveBeenCalled();
    }
  });
  it("rename renames the FIELD (with the stamp read here) and then clears any view label for the key", async () => {
    const d = deps();
    expect(await changeFirmColumn(d, { op: "rename", key: KEY, label: "Urgency" })).toEqual({ ok: true });
    expect(d.update).toHaveBeenCalledWith({ op: "rename", id: ID, label: "Urgency", updatedAt: "2026-11-20T10:00:00+00:00" });
    expect(d.clearLabels).toHaveBeenCalledWith(KEY);
  });
  it("a refused field rename (a clash, the owner rule) is the answer and clears nothing", async () => {
    const d = deps({ update: vi.fn(async () => ({ error: W.labelTaken("Urgency") })) });
    expect(await changeFirmColumn(d, { op: "rename", key: KEY, label: "Urgency" })).toEqual({ ok: false, error: W.labelTaken("Urgency") });
    expect(d.clearLabels).not.toHaveBeenCalled();
  });
  it("renamed but a label couldn't be cleared: ok, with the fixed sentence", async () => {
    const d = deps({ clearLabels: vi.fn(async () => false) });
    expect(await changeFirmColumn(d, { op: "rename", key: KEY, label: "Urgency" })).toEqual({ ok: true, note: W.FIRM_COLUMN_LABEL_NOT_CLEARED });
    const t = deps({ clearLabels: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect(await changeFirmColumn(t, { op: "rename", key: KEY, label: "Urgency" })).toMatchObject({ ok: true, note: W.FIRM_COLUMN_LABEL_NOT_CLEARED });
  });
  it("options and archive go to the field logic and never touch view labels", async () => {
    const d = deps();
    expect(await changeFirmColumn(d, { op: "options", key: KEY, choices: "High\nLow" })).toEqual({ ok: true });
    expect(d.update).toHaveBeenLastCalledWith({ op: "options", id: ID, choices: "High\nLow", updatedAt: "2026-11-20T10:00:00+00:00" });
    expect(await changeFirmColumn(d, { op: "archive", key: KEY })).toEqual({ ok: true });
    expect(d.update).toHaveBeenLastCalledWith({ op: "archive", id: ID });
    expect(d.clearLabels).not.toHaveBeenCalled();
  });
  it("only a firm column key and a known op; a missing field and an unreadable one say so; nothing is written", async () => {
    const d = deps();
    for (const input of [{ op: "rename", key: "status", label: "x" }, { op: "delete", key: KEY }, { op: "rename", key: `cf:${ID.toUpperCase()}` }]) expect((await changeFirmColumn(d, input)).ok).toBe(false);
    expect(d.update).not.toHaveBeenCalled();
    expect(await changeFirmColumn(deps({ readStamp: vi.fn(async () => null) }), { op: "archive", key: KEY })).toEqual({ ok: false, error: W.CUSTOM_FIELD_GONE });
    expect(await changeFirmColumn(deps({ readStamp: vi.fn(async () => Promise.reject(new Error("db"))) }), { op: "archive", key: KEY })).toEqual({ ok: false, error: W.CUSTOM_SAVE_FAILED_READ });
    expect(await changeFirmColumn(deps({ update: vi.fn(async () => Promise.reject(new Error("db"))) }), { op: "archive", key: KEY })).toEqual({ ok: false, error: W.CUSTOM_SAVE_FAILED });
  });
});
