import { describe, it, expect, vi } from "vitest";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Lifecycle } from "@/components/proposal-editor/Lifecycle";
import { MoreSaveButton, UnsavedGuardProvider, UnsavedPill } from "@/components/proposal-editor/UnsavedGuard";
import { SaveRow } from "@/components/proposal-editor/ActionForm";
import { NameMoreFields, NameRowsProvider, nameFormId, type NameValues } from "@/components/proposal-editor/Sections";

vi.mock("@/app/dashboard/proposals/[id]/actions", () => ({
  createLinkAction: vi.fn(),
  queuePostConsultEmailAction: vi.fn(),
  reviseAction: vi.fn(),
  sendAction: vi.fn(),
  unapproveAction: vi.fn(),
  withdrawAction: vi.fn(),
  resetAcceptanceAction: vi.fn(),
  deleteProposalAction: vi.fn(),
  addNameAction: vi.fn(),
  removeNameAction: vi.fn(),
  saveAdjustmentsAction: vi.fn(),
  saveDetailsAction: vi.fn(),
  saveIncludesAction: vi.fn(),
  saveMessageAction: vi.fn(),
  saveNameAction: vi.fn(),
  savePricingAction: vi.fn(),
}));

const lifecycle = (status: "draft" | "approved") =>
  createElement(Lifecycle, {
    proposalId: "p1",
    status,
    version: 1,
    canWrite: true,
    isApprover: true,
    blockingErrors: 0,
    approverNames: ["Rebecca"],
    clientUrl: null,
  });

describe("Save and create link with unsaved changes", () => {
  it("is enabled with no sentence when everything is saved", () => {
    const html = renderToStaticMarkup(createElement(UnsavedGuardProvider, null, lifecycle("draft")));
    expect(html).toMatch(/<button type="submit" class="lx-btn lx-btn-pri">Save and create link/);
    expect(html).not.toContain("Save your changes to");
  });
  it("is disabled and names the brand name, wired with aria-describedby", () => {
    const html = renderToStaticMarkup(
      createElement(UnsavedGuardProvider, { initial: { "pe-name-p1-n1": "The Fold" } }, lifecycle("draft")),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="pe-unsaved-why-p1"[^>]*>Save and create link/);
    expect(html).toContain('id="pe-unsaved-why-p1"');
    expect(html).toContain("Save your changes to The Fold first.");
  });
  it("also holds back Turn on the link", () => {
    const html = renderToStaticMarkup(
      createElement(UnsavedGuardProvider, { initial: { a: "The Fold", b: "Client" } }, lifecycle("approved")),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Turn on the link/);
    expect(html).toContain("Save your changes to The Fold and Client first.");
  });
});

describe("pill and primary Save", () => {
  it("shows the pill and a primary Save only for an unsaved form", () => {
    const tree = (initial: Record<string, string>) =>
      renderToStaticMarkup(
        createElement(
          UnsavedGuardProvider,
          { initial },
          createElement(UnsavedPill, { formId: "f1" }),
          createElement(SaveRow, { editable: true, state: {}, pending: false, label: "Save client", formId: "f1" }),
        ),
      );
    const dirty = tree({ f1: "Client" });
    expect(dirty).toContain("Unsaved changes");
    expect(dirty).toContain("lx-btn-pri");
    const clean = tree({});
    expect(clean).not.toContain("Unsaved changes");
    expect(clean).toContain("lx-btn-sec");
  });
});

describe("More options Save button", () => {
  it("carries the brand name's form attribute", () => {
    const html = renderToStaticMarkup(createElement(MoreSaveButton, { formId: "pe-name-p1-n1", label: "Save The Fold" }));
    expect(html).toMatch(/<button type="submit" form="pe-name-p1-n1"/);
    expect(html).toContain("Save The Fold");
  });
  it("is drawn by NameMoreFields for the same form id as the name's card", () => {
    const value = { id: "n1", name: "The Fold", what: "", note: "", overrideBase: "", overridePerClass: "", marks: [], classes: [], discountPct: "", packageChoice: null } as unknown as NameValues;
    const html = renderToStaticMarkup(
      createElement(
        UnsavedGuardProvider,
        null,
        createElement(
          NameRowsProvider,
          { names: [value] } as React.ComponentProps<typeof NameRowsProvider>,
          createElement(NameMoreFields, { proposalId: "p1", editable: true, value, packageName: "Essential", firmPackages: [] }),
        ),
      ),
    );
    expect(html).toContain(`form="${nameFormId("p1", "n1")}"`);
    expect(html).toMatch(/<button type="submit" form="pe-name-p1-n1"[^>]*>Save The Fold/);
  });
});
