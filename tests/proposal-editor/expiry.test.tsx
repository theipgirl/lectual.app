import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExpiryField } from "@/components/proposal-editor/ExpiryField";
import { EXPIRY_PASSED_WARNING, expiryWarning } from "@/lib/proposal-editor/expiry-warning";

describe("the expiry date warning", () => {
  it("warns only for a date before today, in plain words", () => {
    expect(EXPIRY_PASSED_WARNING).toBe("This date has passed. Pick a new expiry date before creating the link.");
    expect(expiryWarning("2026-10-28", "2026-10-28")).toBeNull();
    expect(expiryWarning("2026-10-27", "2026-10-28")).toBe(EXPIRY_PASSED_WARNING);
    expect(expiryWarning("2026-10-01", "2026-10-28")).toBe(EXPIRY_PASSED_WARNING);
  });
  it("says nothing for a later date, a blank or an unreadable one", () => {
    expect(expiryWarning("2026-10-29", "2026-10-28")).toBeNull();
    expect(expiryWarning("", "2026-10-28")).toBeNull();
    expect(expiryWarning(null, "2026-10-28")).toBeNull();
    expect(expiryWarning("soon", "2026-10-28")).toBeNull();
  });
  it("the field draws the warning under a past date and posts expiresOn", () => {
    const past = renderToStaticMarkup(createElement(ExpiryField, { defaultValue: "2026-10-01", today: "2026-10-28" }));
    expect(past).toContain('name="expiresOn"');
    expect(past).toContain(EXPIRY_PASSED_WARNING);
    const future = renderToStaticMarkup(createElement(ExpiryField, { defaultValue: "2026-11-10", today: "2026-10-28" }));
    expect(future).not.toContain(EXPIRY_PASSED_WARNING);
  });
});
