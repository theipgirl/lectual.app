import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WaitingOnStrip } from "@/components/review/ReviewViews";
import { parseReviewParams } from "@/lib/review/params";
import { waitingOnPerson } from "@/lib/review/strips";
import { row } from "./fixtures";

const params = parseReviewParams({});
const step = (a: string) => ({ id: "t", title: "Sign", dueDate: null, assigneeId: a });

describe("Waiting on you", () => {
  it("lists the signed-in approver's next steps plus approvals", () => {
    const rows = [row({ key: "1", client: "Mine", nextStep: step("u-me") }), row({ key: "2", client: "Appr", waiting: "approval" }), row({ key: "3", client: "Other", nextStep: step("u-x") })];
    const html = renderToStaticMarkup(<WaitingOnStrip firstName="you" you personId="u-me" rows={waitingOnPerson(rows, "u-me")} approvalsKnown params={params} />);
    expect(html).toContain("Waiting on you");
    expect(html).toContain("Mine");
    expect(html).toContain("Appr");
    expect(html).not.toContain("Other");
  });
  it("keeps the failed-approvals sentence and the empty sentence in the second person", () => {
    const failed = renderToStaticMarkup(<WaitingOnStrip firstName="you" you personId="u" rows={[]} approvalsKnown={false} params={params} />);
    expect(failed).toContain("only next steps assigned to you are listed");
    expect(failed).not.toContain("Nothing is waiting");
    expect(renderToStaticMarkup(<WaitingOnStrip firstName="you" you personId="u" rows={[]} approvalsKnown params={params} />)).toContain("Nothing is waiting on you.");
  });
  it("without `you` it still names the person", () => {
    const html = renderToStaticMarkup(<WaitingOnStrip firstName="Rebecca" personId="u" rows={[]} approvalsKnown params={params} />);
    expect(html).toContain("Waiting on Rebecca");
  });
});
