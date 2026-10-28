import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceCell } from "../../src/components/reconcile/SourceCell";
import { SOURCE_LABEL } from "../../src/lib/reconcile/types";
import { S, stageSignal, unavailable } from "./helpers";

const text = (html: string) => html.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("<!-- -->", "");

describe("the Email / calendar cell (Sprint 16, F19)", () => {
  it("is named Email / calendar", () => {
    expect(SOURCE_LABEL.email).toBe("Email / calendar");
  });

  it("an agent move or a pending suggestion reads with its stage and its wording", () => {
    const move = text(renderToStaticMarkup(<SourceCell source="email" signal={stageSignal(S.loe, "Automatic move: LOE sent", "2026-09-09T10:00:00Z")} />));
    expect(move).toContain("LOE &amp; Invoice Sent");
    expect(move).toContain('Email / calendar says "Automatic move: LOE sent"');
    const suggestion = text(renderToStaticMarkup(<SourceCell source="email" signal={stageSignal(S.post, "Automatic move suggested: Post-consult sent")} />));
    expect(suggestion).toContain('Email / calendar says "Automatic move suggested: Post-consult sent"');
  });

  it("an unreadable source is Unavailable with its reason, never None", () => {
    const html = text(renderToStaticMarkup(<SourceCell source="email" signal={unavailable("The synced mail and the Stage Keeper's moves on the timeline could not be read. Try again shortly.")} />));
    expect(html).toContain("Unavailable");
    expect(html).not.toContain(">None<");
  });
});
