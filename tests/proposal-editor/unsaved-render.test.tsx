import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { UnsavedGuardProvider, UnsavedMarker } from "@/components/proposal-editor/UnsavedGuard";
import { EditorActions } from "@/components/proposal-editor/EditorActions";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  saveDraftAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
  resetAcceptanceAction: vi.fn(),
  deleteProposalAction: vi.fn(),
}));

const lifecycle = (status: "draft" | "approved") => createElement(Lifecycle, { proposalId: "p1", status, version: 1, canWrite: true, clientUrl: null });
const wrap = (dirty: boolean, ...children: React.ReactNode[]) =>
  renderToStaticMarkup(createElement(UnsavedGuardProvider, { initial: { dirty } }, ...children));

describe("the page-level unsaved marker", () => {
  it("renders one marker while unsaved and none when saved", () => {
    const dirty = wrap(true, createElement(UnsavedMarker));
    expect(dirty.match(/Unsaved changes/g)).toHaveLength(1);
    expect(wrap(false, createElement(UnsavedMarker))).not.toContain("Unsaved changes");
  });
});

describe("Turn on the link (a saved version) waits for unsaved changes", () => {
  it("is enabled with no sentence when everything is saved", () => {
    const html = wrap(false, lifecycle("approved"));
    expect(html).toMatch(/<button type="submit" class="lx-btn lx-btn-pri">Turn on the link/);
    expect(html).not.toContain("Save your changes first.");
  });
  it("is disabled and says to save first", () => {
    const html = wrap(true, lifecycle("approved"));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Turn on the link/);
    expect(html).toContain("Save your changes first.");
  });
});

describe("Save and create link is NOT disabled by unsaved changes: it saves first, and says so", () => {
  const actions = createElement(EditorActions, { canSave: true, canCreateLink: true, askText: null, blocking: 0 });
  it("unsaved: enabled, shows 'Saves first', Save takes the primary style", () => {
    const html = wrap(true, actions);
    expect(html).toMatch(/<button type="submit" form="pe-draft" value="link" class="lx-btn lx-btn-pri" name="intent">Save and create link/);
    expect(html).toContain("Saves first");
    expect(html).toMatch(/value="save" class="lx-btn lx-btn-pri"/);
  });
  it("saved: no 'Saves first', Save is secondary", () => {
    const html = wrap(false, actions);
    expect(html).not.toContain("Saves first");
    expect(html).toMatch(/value="save" class="lx-btn lx-btn-sec"/);
  });
});
