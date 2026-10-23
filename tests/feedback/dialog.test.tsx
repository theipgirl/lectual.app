import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

vi.mock("@/app/dashboard/feedback-actions", () => ({ sendFeedbackAction: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/" }));

import { FeedbackDialogView } from "@/components/feedback/FeedbackDialog";
import { SendFeedbackButton } from "@/components/feedback/SendFeedbackButton";
import { beginSend, canSend, finishSend, initialDialogState, shouldCloseOnKey } from "@/lib/feedback/dialog";
import { FEEDBACK_DISCLOSURE, SHOW_FEEDBACK_EVENT } from "@/lib/feedback/constants";
import { requestFeedback } from "@/lib/feedback/open";
import { focusRestoreTarget, tourKeyAction } from "@/lib/onboarding/engine";

const noop = () => {};
const view = (over = {}) =>
  renderToStaticMarkup(createElement(FeedbackDialogView, { state: { ...initialDialogState(), ...over }, onType: noop, onText: noop, onSend: noop, onClose: noop }));

describe("B1/B2: the dialog", () => {
  it("shows the disclosure verbatim", () => {
    const literal = "This report will include your description and the current session transcript. We may use these to debug related issues and improve Lectual.";
    expect(FEEDBACK_DISCLOSURE).toBe(literal);
    expect(view()).toContain(literal);
  });
  it("is an accessible dialog with the four types (Bug first), a required 5,000-character textarea, a count, Cancel and Send", () => {
    const html = view({ description: "hello" });
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="[^"]+"/);
    expect(html).toContain("Send feedback");
    const options = [...html.matchAll(/<option value="([a-z]+)"[^>]*>([^<]+)<\/option>/g)].map((m) => m[2]);
    expect(options).toEqual(["Bug", "Request", "Question", "Other"]);
    expect(html).toMatch(/<select[^>]*value="bug"|<option value="bug" selected/);
    expect(html).toMatch(/<textarea[^>]*required=""[^>]*/);
    expect(html).toContain('maxLength="5000"');
    expect(html).toContain("5 / 5,000");
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Send<");
  });
  it("uses the shared lx classes and no inline hex colours", () => {
    expect(view()).toContain("lx-btn lx-btn-pri lx-btn-sm");
    expect(readFileSync("src/components/feedback/feedback.css", "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("Esc closes, Tab wraps, using the tour's helpers", () => {
    expect(tourKeyAction({ key: "Escape" }, { count: 4, current: 1 })).toMatchObject({ kind: "skip" });
    expect(tourKeyAction({ key: "Tab" }, { count: 4, current: 3 })).toEqual({ kind: "focus", index: 0, preventDefault: true });
    expect(tourKeyAction({ key: "Tab", shiftKey: true }, { count: 4, current: 0 })).toEqual({ kind: "focus", index: 3, preventDefault: true });
    expect(shouldCloseOnKey("Escape", initialDialogState())).toBe(true);
    expect(shouldCloseOnKey("Escape", { ...initialDialogState(), status: "sending" })).toBe(false);
    const el = { focus: vi.fn(), isConnected: true };
    expect(focusRestoreTarget(el)).toBe(el);
    expect(focusRestoreTarget({ focus: vi.fn(), isConnected: false })).toBeNull();
    const src = readFileSync("src/components/feedback/FeedbackDialog.tsx", "utf8");
    expect(src).toMatch(/import \{[^}]*tourKeyAction[^}]*\} from "@\/lib\/onboarding\/engine"/);
    expect(src).not.toMatch(/function (tourKeyAction|nextTabFocus)/);
  });
});

describe("B3: entry points", () => {
  it("the button dispatches the one event with its opener", () => {
    expect(renderToStaticMarkup(createElement(SendFeedbackButton))).toContain(">Send feedback<");
    const seen: Event[] = [];
    const opener = { focus: vi.fn() };
    requestFeedback({ dispatchEvent: (e) => (seen.push(e), true) }, opener);
    expect(seen[0].type).toBe(SHOW_FEEDBACK_EVENT);
    expect((seen[0] as CustomEvent).detail.opener).toBe(opener);
  });
  it("the account menu and the Getting started footer carry it; one dialog is mounted; the layout gains two lines", () => {
    expect(readFileSync("src/components/shell/AccountMenu.tsx", "utf8")).toMatch(/requestFeedback\([\s\S]*Send feedback/);
    expect(readFileSync("src/app/dashboard/getting-started/page.tsx", "utf8")).toMatch(/<footer[\s\S]*<SendFeedbackButton \/>/);
    const layout = readFileSync("src/app/dashboard/layout.tsx", "utf8");
    expect(layout.match(/<FeedbackDialog \/>/g)).toHaveLength(1);
    expect(layout.match(/<FeedbackTrailRecorder \/>/g)).toHaveLength(1);
  });
});

describe("B13: the send flow", () => {
  const typed = { ...initialDialogState(), description: "It broke" };
  it("Send is disabled while empty and while sending", () => {
    expect(canSend(initialDialogState())).toBe(false);
    expect(canSend({ ...initialDialogState(), description: "   " })).toBe(false);
    expect(view({ description: "" })).toMatch(/<button[^>]*disabled=""[^>]*>Send<\/button>/);
    expect(view({ description: "x", status: "sending" })).toMatch(/<button[^>]*disabled=""[^>]*>Sending…<\/button>/);
  });
  it("a double click sends once", async () => {
    const send = vi.fn(async () => ({ ok: true as const }));
    const first = beginSend(typed);
    expect(first?.status).toBe("sending");
    expect(beginSend(first!)).toBeNull();
    await finishSend(first!, send);
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("success shows the confirmation", async () => {
    const done = await finishSend(beginSend(typed)!, async () => ({ ok: true }));
    const html = view(done);
    expect(html).toContain("Thanks. Your feedback was sent.");
    expect(html).toContain(">Close<");
  });
  it("an error stays open with the text in an alert and the description kept; a throw reads as the fixed sentence", async () => {
    const failed = await finishSend(beginSend(typed)!, async () => ({ ok: false, error: "Feedback isn't set up yet." }));
    expect(failed.status).toBe("idle");
    const html = view(failed);
    expect(html).toMatch(/role="alert"[^>]*>Feedback isn&#x27;t set up yet\./);
    expect(html).toContain("It broke");
    const thrown = await finishSend(beginSend(typed)!, async () => { throw new Error("raw detail"); });
    expect(thrown.error).toBe("We couldn't send your feedback. Please try again in a moment.");
    expect(thrown.description).toBe("It broke");
  });
});
