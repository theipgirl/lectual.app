import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { NOT_LIVE_MESSAGE, shareState } from "@/lib/intake-forms/share";
import { IntakeQrButton } from "@/app/dashboard/forms/_components/IntakeQr";

describe("shareState", () => {
  it("live forms can be shared", () => expect(shareState("live")).toEqual({ canShare: true }));
  it("draft forms cannot", () => expect(shareState("draft")).toEqual({ canShare: false, message: NOT_LIVE_MESSAGE }));
  it("archived forms cannot", () => expect(shareState("archived")).toEqual({ canShare: false, message: NOT_LIVE_MESSAGE }));
  it("an unknown status fails closed", () => expect(shareState("???").canShare).toBe(false));
  it("the message is the agreed sentence", () => expect(NOT_LIVE_MESSAGE).toBe("Not live yet. Publish the form to share it."));
});

describe("QR button", () => {
  it("is disabled, described, for a form that is not live", () => {
    const html = renderToStaticMarkup(<IntakeQrButton url="https://x/i/a" name="A" slug="a" shareable={false} describedBy="why" />);
    expect(html).toContain("disabled");
    expect(html).toContain('aria-describedby="why"');
  });
  it("opens a dialog for a live form", () => {
    const html = renderToStaticMarkup(<IntakeQrButton url="https://x/i/a" name="A" slug="a" />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("disabled");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.(tsx|ts)$/.test(n) ? [p] : [];
  });
}

describe("every place that offers the public intake link asks shareState", () => {
  const files = [...sources("src/app/dashboard"), ...sources("src/components")];
  const offering = files.filter((f) => /intakePublicUrl\(|publicUrl|i\.url/.test(readFileSync(f, "utf8")) && /Copy link|IntakeQrButton|Preview/.test(readFileSync(f, "utf8")));
  it("finds the list and the editor", () => {
    expect(offering.some((f) => f.endsWith("IntakeList.tsx"))).toBe(true);
    expect(offering.some((f) => f.endsWith("IntakeFormsWorkspace.tsx"))).toBe(true);
  });
  it.each(offering.filter((f) => !f.endsWith("IntakeQr.tsx") && !f.includes("quotes")))("%s uses shareState", (f) => {
    expect(readFileSync(f, "utf8")).toContain("shareState");
  });
});
