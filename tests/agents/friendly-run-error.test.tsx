import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  RUN_BUSY_SENTENCE,
  RUN_FAILED_FALLBACK,
  RUN_RECONNECT_MAILBOX_SENTENCE,
  RUN_RECONNECT_MEETINGS_SENTENCE,
  RUN_TIME_LIMIT_SENTENCE,
  friendlyRunError,
} from "@/lib/agents/friendly-run-error";
import { DID_NOT_FINISH_ERROR } from "@/lib/agents/run-status";
import { failureAction, plainReason } from "@/lib/agents/digest";
import { RunResultCell, runResultText } from "@/components/agents/RunResultCell";

const SENTINEL = "SENTINEL raw provider text";

describe("friendlyRunError", () => {
  it.each([
    [DID_NOT_FINISH_ERROR, "It ran out of time before it finished. Try Run now again later."],
    ["The scheduled run ran out of time before this agent's turn.", RUN_TIME_LIMIT_SENTENCE],
    ["Access to this mailbox was withdrawn. Reconnect to resume syncing.", RUN_RECONNECT_MAILBOX_SENTENCE],
    ["invalid_grant", RUN_RECONNECT_MAILBOX_SENTENCE],
    ["Zoom refused the token", RUN_RECONNECT_MEETINGS_SENTENCE],
    ["Fathom stopped accepting the key", RUN_RECONNECT_MEETINGS_SENTENCE],
    ["anthropic overloaded_error 529", RUN_BUSY_SENTENCE],
    [SENTINEL, RUN_FAILED_FALLBACK],
    ["3 lead move(s) failed.", RUN_FAILED_FALLBACK],
  ])("%j reads %j", (raw, expected) => {
    expect(friendlyRunError(raw)).toBe(expected);
  });

  it("the fallback says Lectual has been told and echoes nothing", () => {
    expect(RUN_FAILED_FALLBACK).toBe("This run failed. Lectual has been told and is looking into it.");
    expect(friendlyRunError(SENTINEL)).not.toContain("SENTINEL");
  });

  it("a missing error still reads Failed", () => {
    expect(friendlyRunError(null)).toBe("Failed");
    expect(friendlyRunError(undefined)).toBe("Failed");
    expect(friendlyRunError("   ")).toBe("Failed");
  });

  it("the digest's reason line goes through it, and its action links are untouched", () => {
    expect(plainReason(SENTINEL)).toBe(RUN_FAILED_FALLBACK);
    expect(plainReason(null)).toBe("The run stopped without saying why.");
    expect(failureAction("Access to this mailbox was withdrawn. Reconnect to resume syncing.")).toEqual({ label: "Reconnect the mailbox", href: "/dashboard/settings/mailboxes/" });
    expect(failureAction(DID_NOT_FINISH_ERROR)).toEqual({ label: "Try Run now later", href: "/dashboard/agents/" });
  });
});

describe("the Recent runs result cell", () => {
  const cell = (status: string, run: { summary: string | null; error: string | null }) =>
    renderToStaticMarkup(
      <table>
        <tbody>
          <tr>
            <RunResultCell status={status} run={run} failed={status === "error"} />
          </tr>
        </tbody>
      </table>,
    );

  it("a failed run with a sentinel error shows the fixed sentence and not the sentinel", () => {
    const html = cell("error", { summary: null, error: SENTINEL });
    expect(html).toContain(RUN_FAILED_FALLBACK);
    expect(html).not.toContain("SENTINEL");
  });

  it("a null error reads Failed; a finished run still shows its summary; a cut-off run says so", () => {
    expect(runResultText("error", { summary: null, error: null })).toBe("Failed");
    expect(runResultText("ok", { summary: "2 read", error: null })).toBe("2 read");
    expect(runResultText("ok", { summary: null, error: null })).toBe("—");
    expect(runResultText("unfinished", { summary: null, error: null })).toBe("Didn't finish. It was stopped before it could report back.");
  });
});
