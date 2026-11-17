import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelShell } from "@/components/review/PanelShell";

/** The Weekly review's drawer renders byte for byte as before (markup taken from PanelShell at 190d147). */
const BEFORE =
  '<div class="rv-panel-wrap"><a class="rv-panel-backdrop" tabindex="-1" aria-hidden="true" href="/dashboard/review?view=board"></a><aside class="rv-panel" role="dialog" aria-modal="true" aria-labelledby="rv-t" tabindex="-1"><h2 id="rv-t">Maya</h2></aside></div>';

const render = (placement?: "drawer" | "centre") =>
  renderToStaticMarkup(
    <PanelShell closeHref="/dashboard/review/?view=board" titleId="rv-t" {...(placement ? { placement } : {})}>
      <h2 id="rv-t">Maya</h2>
    </PanelShell>,
  );

describe("PanelShell placement", () => {
  it("the default is the review's drawer, unchanged", () => {
    expect(render()).toBe(BEFORE);
    expect(render("drawer")).toBe(BEFORE);
  });
  it("centre adds only its two classes; the dialog, labels and close link are the same", () => {
    const centre = render("centre");
    expect(centre).toBe(BEFORE.replace('class="rv-panel-wrap"', 'class="rv-panel-wrap rv-panel-wrap-centre"').replace('class="rv-panel"', 'class="rv-panel rv-panel-centre"'));
  });
});
