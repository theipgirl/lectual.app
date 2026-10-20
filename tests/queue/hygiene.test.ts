import { describe, it, expect } from "vitest";
import {
  approvalBlock,
  auditDraft,
  cleanDraftBody,
  enforceSignOff,
  isNearDuplicate,
  markNearDuplicates,
  movedSummary,
  removeInternalNotes,
  signOffSummary,
  type AuditContext,
  type DraftProbe,
} from "@/lib/queue/hygiene";
import { buildMonthlyStatusUpdateDraft } from "@/lib/matters/filing-followup";
import { buildWelcomeEmailDraft } from "@/lib/welcome/welcome-email";

const DIRTY =
  "⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.\nHi Ana,\nHard Rule 2: never quote fees.\nThanks for your time [confirm client email before sending].\nBest,\nRebecca";

describe("cleanDraftBody (H1)", () => {
  it("removes the banner, the worksheet line and the bracketed instruction", () => {
    const { body, moved } = cleanDraftBody(DIRTY);
    for (const gone of ["DRAFT — FOR ATTORNEY REVIEW", "NOT SENT", "Hard Rule 2", "[confirm"]) expect(body).not.toContain(gone);
    expect(body).toContain("Hi Ana,");
    expect(body).toContain("Thanks for your time");
    expect(body.endsWith("Best,\nRebecca")).toBe(true);
    expect(moved).toContain("⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.");
    expect(moved).toContain("Hard Rule 2: never quote fees.");
    expect(moved).toContain("[confirm client email before sending]");
    expect(moved).toHaveLength(3);
  });

  it("leaves no stray space before the full stop, and no blank line at the top", () => {
    const { body } = cleanDraftBody(DIRTY);
    expect(body).toContain("Thanks for your time.");
    expect(body).not.toContain("time .");
    expect(body.startsWith("Hi Ana,")).toBe(true);
    expect(body).toBe("Hi Ana,\nThanks for your time.\nBest,\nRebecca");
  });

  it("closes the gap a removed line leaves between paragraphs", () => {
    const { body } = cleanDraftBody("Hello,\n\nRule 3: never quote.\n\nSee you Monday.\n\nBest,\nRebecca");
    expect(body).toBe("Hello,\n\nSee you Monday.\n\nBest,\nRebecca");
  });

  it("removes a banner line that is the whole first paragraph, with its blank line", () => {
    expect(cleanDraftBody("NOT SENT\n\nHello,\n\nBest,\nR").body).toBe("Hello,\n\nBest,\nR");
  });
});

describe("cleanDraftBody is conservative (H2)", () => {
  it("returns a clean email byte-identical, with nothing moved", () => {
    const clean = "Hi Ana,\n\nThanks for the call. Here is the draft agreement and the rule we discussed.\n\n- one\n- two\n\nBest,\nRebecca P. Beliard, Esq.\n";
    const r = cleanDraftBody(clean);
    expect(r.body).toBe(clean);
    expect(r.moved).toEqual([]);
  });

  it("is idempotent", () => {
    const once = cleanDraftBody(DIRTY).body;
    const twice = cleanDraftBody(once);
    expect(twice.body).toBe(once);
    expect(twice.moved).toEqual([]);
  });

  it("leaves ordinary prose containing 'draft' or 'rule' alone", () => {
    const text = "I attached the draft for your review.\nThe rule of thumb is to file early.\nA draft is not sent until you approve it.";
    expect(cleanDraftBody(text)).toEqual({ body: text, moved: [] });
  });

  it("leaves a heading with DRAFT in it alone", () => {
    const text = "# Acme — Opinion Letter DRAFT — MARKNAME\n\nBody...";
    expect(cleanDraftBody(text)).toEqual({ body: text, moved: [] });
  });

  it("does not treat a Markdown link whose text starts with 'confirm' as a placeholder", () => {
    const text = "Please [confirm your details](https://a.example) before Friday.";
    expect(cleanDraftBody(text)).toEqual({ body: text, moved: [] });
  });

  it.each([
    ["[insert client name here]", "Dear [insert client name here],"],
    ["[verify the filing date]", "Filed on [verify the filing date]."],
    ["[TODO check fee]", "Fee is $850 [TODO check fee]."],
    ["[TBD]", "Start date: [TBD]"],
    ["[placeholder for logo]", "Our mark [placeholder for logo] is new."],
  ])("removes %s", (fragment, line) => {
    const r = cleanDraftBody(`Hi\n${line}\nBye`);
    expect(r.body).not.toContain(fragment);
    expect(r.moved).toContain(fragment);
    expect(r.body.startsWith("Hi\n")).toBe(true);
  });

  it.each(["Rule 3: do not quote fees.", "Note to reviewer: check the class.", "Note to attorney: please confirm.", "Internal: this client is slow to pay.", "Reviewer note: tone is firm."])(
    "removes the worksheet line %s",
    (line) => {
      const r = cleanDraftBody(`Hello\n${line}\nBest,\nRebecca`);
      expect(r.body).toBe("Hello\nBest,\nRebecca");
      expect(r.moved).toEqual([line]);
    },
  );

  it.each(["DRAFT - NOT SENT", "*** NOT SENT ***", "> **Draft for attorney review. Not sent.**", "DRAFT – FOR ATTORNEY REVIEW", "✋ NOT SENT — DRAFT"])(
    "removes the banner %s, with or without emoji and with different dashes",
    (banner) => {
      const r = cleanDraftBody(`${banner}\n\nHello,\n\nBest,\nR`);
      expect(r.body).toBe("Hello,\n\nBest,\nR");
      expect(r.moved).toHaveLength(1);
    },
  );

  it("does not touch Rule citations that are not worksheet lines", () => {
    const text = "Rule 12(b) motions are due soon.\nThe Hard cases are the rest.";
    expect(cleanDraftBody(text).moved).toEqual([]);
  });

  it("removes a trailing '---' separator and its Internal paragraph as a unit", () => {
    const r = cleanDraftBody(
      "Hello Jane,\n\nWe're on track.\n\nWarm regards,\nRPB Law Operations\n\n---\nInternal (not part of the email): Month 2 of ~5, computed from the filing date.\nConfirm before approving.",
    );
    expect(r.body).toBe("Hello Jane,\n\nWe're on track.\n\nWarm regards,\nRPB Law Operations");
    expect(r.moved).toHaveLength(1);
    expect(r.moved[0]).toContain("Month 2 of ~5");
    expect(r.moved[0]).toContain("Confirm before approving.");
  });

  it("keeps the final newline of a body that had one", () => {
    expect(cleanDraftBody("Hi\nNOT SENT\n").body).toBe("Hi\n");
  });

  it("can leave bracketed instructions alone (the Document Center keeps its fill-ins)", () => {
    const text = "# Letter DRAFT\n\nClass(es): [confirm from the report]\n";
    expect(cleanDraftBody(text, { placeholders: false })).toEqual({ body: text, moved: [] });
    expect(removeInternalNotes(text, "OPINION_LETTER")).toEqual({ body: text, moved: [] });
    expect(removeInternalNotes(text, "CLIENT_EMAIL").moved).toEqual(["[confirm from the report]"]);
  });

  it("handles Windows line endings", () => {
    const r = cleanDraftBody("NOT SENT\r\nHello,\r\nHard Rule 2: no fees\r\nBest,\r\nR");
    expect(r.body).toBe("Hello,\r\nBest,\r\nR");
  });

  it("a body that is only a banner becomes empty rather than throwing", () => {
    expect(cleanDraftBody("NOT SENT")).toEqual({ body: "", moved: ["NOT SENT"] });
    expect(cleanDraftBody("")).toEqual({ body: "", moved: [] });
  });
});

describe("realistic builders (H2)", () => {
  it("the filing follow-up loses its banner and the internal trailer, keeps the email", () => {
    const { draftBody } = buildMonthlyStatusUpdateDraft({
      clientFirstName: "Jane",
      markText: "SUNBEAM",
      monthNumber: 2,
      monthsRemainingEstimate: 3,
    } as Parameters<typeof buildMonthlyStatusUpdateDraft>[0]);
    const r = cleanDraftBody(draftBody);
    expect(r.body).not.toContain("NOT SENT");
    expect(r.body).not.toContain("Internal (not part of the email)");
    expect(r.body).not.toContain("---");
    expect(r.body.startsWith("Hello Jane,")).toBe(true);
    expect(r.body.endsWith("Warm regards,\nRPB Law Operations")).toBe(true);
    expect(r.moved).toHaveLength(2);
  });

  it("the welcome email loses its Hard Rule line and its confirm bracket, and keeps its title", () => {
    const { draftBody } = buildWelcomeEmailDraft({
      clientOrEntityName: "Acme Co.",
      matterNumber: "RPB-0042",
      markText: "SUNBEAM",
      clientEmail: null,
      sendDateIso: "2026-10-21",
    } as Parameters<typeof buildWelcomeEmailDraft>[0]);
    const r = cleanDraftBody(draftBody);
    expect(r.body).toContain("# Acme Co. — Welcome email DRAFT — RPB-0042");
    expect(r.body).not.toContain("Hard Rule 2");
    expect(r.body).not.toContain("[confirm");
    expect(r.moved.some((m) => m.includes("[confirm client email on the lead record]"))).toBe(true);
    expect(r.moved.some((m) => m.startsWith("Hard Rule 2"))).toBe(true);
  });
});

describe("enforceSignOff (H3)", () => {
  const SIGN = "Rebecca P. Beliard, Esq.";

  it("replaces another staff member's signature with the configured one and says what it replaced", () => {
    const r = enforceSignOff("Hi Ana,\n\nThanks for the call.\n\nBest,\nDawn", { signOff: SIGN });
    expect(r.body).toBe(`Hi Ana,\n\nThanks for the call.\n\nBest,\n${SIGN}`);
    expect(r.replaced).toBe("Dawn");
    expect(r.flag).toBeNull();
    expect(signOffSummary(r)).toContain("Dawn");
  });

  it("leaves the firm team sign-off alone, with no flag", () => {
    const body = "Hi Ana,\n\nBest,\nThe RPB Law Team";
    const r = enforceSignOff(body, { signOff: SIGN, teamSignOff: "The RPB Law Team" });
    expect(r).toEqual({ body, replaced: null, flag: null });
  });

  it("leaves the configured sign-off alone, with no flag", () => {
    const body = `Hi Ana,\n\nBest,\n${SIGN}`;
    expect(enforceSignOff(body, { signOff: SIGN })).toEqual({ body, replaced: null, flag: null });
  });

  it("accepts the first name of the configured signer", () => {
    const body = "Hi Ana,\n\nBest,\nRebecca";
    expect(enforceSignOff(body, { signOff: SIGN })).toEqual({ body, replaced: null, flag: null });
  });

  it("replaces a '[Your name]' block and an AI-style one", () => {
    expect(enforceSignOff("Hi\n\nSincerely,\n[Your name]", { signOff: SIGN }).body).toBe(`Hi\n\nSincerely,\n${SIGN}`);
    expect(enforceSignOff("Hi\n\nBest regards,\nClaude\nAI Assistant", { signOff: SIGN }).body).toBe(`Hi\n\nBest regards,\n${SIGN}`);
  });

  it("gives a closing with nothing under it the configured sign-off", () => {
    const r = enforceSignOff("Hi\n\nBest,", { signOff: SIGN });
    expect(r.body).toBe(`Hi\n\nBest,\n${SIGN}`);
    expect(r.replaced).toBe("");
    expect(signOffSummary(r)).toContain("added");
  });

  it("replaces a multi-line block with a multi-line sign-off", () => {
    const multi = "Rebecca P. Beliard, Esq.\nRPB Law, PLLC";
    expect(enforceSignOff("Hi\n\nThanks,\nDawn\nParalegal", { signOff: multi }).body).toBe(`Hi\n\nThanks,\n${multi}`);
  });

  it("with no sign-off configured, leaves the body and returns a reviewer flag", () => {
    const body = "Hi Ana,\n\nBest,\nDawn";
    const r = enforceSignOff(body, {});
    expect(r.body).toBe(body);
    expect(r.replaced).toBeNull();
    expect(r.flag).toContain("Sign-off not checked");
    expect(signOffSummary(r)).toBe(r.flag);
  });

  it("with only a team sign-off configured, a different block is flagged, not rewritten", () => {
    const r = enforceSignOff("Hi\n\nBest,\nDawn", { teamSignOff: "The RPB Law Team" });
    expect(r.body).toBe("Hi\n\nBest,\nDawn");
    expect(r.flag).not.toBeNull();
  });

  it("a body with no valediction is unchanged and has no flag", () => {
    const body = "Hi Ana,\n\nSee you Monday.";
    expect(enforceSignOff(body, { signOff: SIGN })).toEqual({ body, replaced: null, flag: null });
    expect(enforceSignOff(body, {})).toEqual({ body, replaced: null, flag: null });
  });

  it("only the closing lines are examined: a 'Thanks,' in the middle of a long email is not the sign-off", () => {
    const body = ["Hi Ana,", "", "Thanks,", "Here is the first part of what we discussed on the call, in a full sentence that runs on.", ...Array.from({ length: 12 }, (_, i) => `Line ${i} of the explanation.`), "", `Best,`, SIGN].join("\n");
    const r = enforceSignOff(body, { signOff: SIGN });
    expect(r.body).toBe(body);
    expect(r.flag).toBeNull();
  });

  it("a long paragraph under a mid-email 'Thanks,' near the end is never mistaken for a signature", () => {
    const body = "Intro.\n\nThanks,\nThis paragraph is body text and not a signature, because it runs well past one hundred characters in a single line of the email.";
    const r = enforceSignOff(body, { signOff: SIGN });
    expect(r.body).toBe(body);
  });

  it("keeps a P.S. after the signature", () => {
    const r = enforceSignOff("Hi\n\nBest,\nDawn\n\nP.S. Bring your ID.", { signOff: SIGN });
    expect(r.body).toBe(`Hi\n\nBest,\n${SIGN}\n\nP.S. Bring your ID.`);
  });

  it.each(["Best,", "Thanks,", "Thank you,", "Sincerely,", "Kind regards,", "Warm regards,", "Regards,", "Best regards,", "Respectfully,"])(
    "recognises the valediction %s",
    (val) => {
      expect(enforceSignOff(`Hi\n\n${val}\nDawn`, { signOff: SIGN }).body).toBe(`Hi\n\n${val}\n${SIGN}`);
    },
  );
});

describe("isNearDuplicate (H4)", () => {
  const T0 = Date.parse("2026-10-20T12:00:00Z");
  const words = Array.from({ length: 120 }, (_, i) => `word${i}`).join(" ");
  const probe = (over: Partial<DraftProbe> = {}): DraftProbe => ({
    type: "CLIENT_EMAIL",
    recipient: "ana@example.com",
    clientName: "Ana Ruiz",
    createdAt: T0,
    body: words,
    ...over,
  });
  const minutes = (m: number) => T0 + m * 60_000;

  it("same type and recipient, 5 minutes apart, one word changed in 120: true", () => {
    expect(isNearDuplicate(probe(), probe({ createdAt: minutes(5), body: words.replace("word60", "changed") }))).toBe(true);
  });

  it("45 minutes apart: false", () => {
    expect(isNearDuplicate(probe(), probe({ createdAt: minutes(45) }))).toBe(false);
  });

  it("exactly 30 minutes apart still counts", () => {
    expect(isNearDuplicate(probe(), probe({ createdAt: minutes(30) }))).toBe(true);
  });

  it("different recipient: false", () => {
    expect(isNearDuplicate(probe(), probe({ recipient: "bo@example.com" }))).toBe(false);
  });

  it("different type: false", () => {
    expect(isNearDuplicate(probe(), probe({ type: "INTERNAL_NOTE" }))).toBe(false);
  });

  it("clearly different bodies: false", () => {
    expect(isNearDuplicate(probe(), probe({ body: Array.from({ length: 120 }, (_, i) => `other${i}`).join(" ") }))).toBe(false);
  });

  it("no recipient on either side: judged on the client name and the other rules", () => {
    const a = probe({ recipient: null });
    expect(isNearDuplicate(a, probe({ recipient: undefined, createdAt: minutes(3) }))).toBe(true);
    expect(isNearDuplicate(a, probe({ recipient: null, clientName: "Someone Else" }))).toBe(false);
  });

  it("a recipient on only one side is not the same email", () => {
    expect(isNearDuplicate(probe({ recipient: null }), probe())).toBe(false);
  });

  it("no recipient and no client name on either side: false (never guessed)", () => {
    expect(isNearDuplicate(probe({ recipient: null, clientName: null }), probe({ recipient: null, clientName: null }))).toBe(false);
  });

  it("two empty bodies: false", () => {
    expect(isNearDuplicate(probe({ body: "" }), probe({ body: "" }))).toBe(false);
    expect(isNearDuplicate(probe({ body: "..." }), probe({ body: "!!" }))).toBe(false);
  });

  it("letter case, punctuation and repeated whitespace do not matter", () => {
    const a = probe({ body: "Hi Ana,\n\nThanks for the call. We'll file on Monday!" });
    const b = probe({ body: "hi ana  thanks   for the call we'll file on monday", createdAt: minutes(1) });
    expect(isNearDuplicate(a, b)).toBe(true);
  });

  it("recipient case and padding do not matter", () => {
    expect(isNearDuplicate(probe(), probe({ recipient: "  ANA@example.com " }))).toBe(true);
  });

  it("is symmetric", () => {
    const pairs: Array<[DraftProbe, DraftProbe]> = [
      [probe(), probe({ createdAt: minutes(5), body: words.replace("word60", "x") })],
      [probe(), probe({ createdAt: minutes(45) })],
      [probe(), probe({ recipient: "z@example.com" })],
      [probe({ body: "short body here" }), probe({ body: "a very different and longer body entirely", createdAt: minutes(2) })],
    ];
    for (const [a, b] of pairs) expect(isNearDuplicate(a, b)).toBe(isNearDuplicate(b, a));
  });

  it("an unreadable timestamp is never a duplicate", () => {
    expect(isNearDuplicate(probe(), probe({ createdAt: "not a date" }))).toBe(false);
  });
});

describe("markNearDuplicates (H10)", () => {
  const body = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
  const item = (id: string, minute: number, over: Record<string, unknown> = {}) => ({
    id,
    type: "CLIENT_EMAIL",
    recipient: "ana@example.com",
    client_name: "Ana",
    created_at: new Date(Date.parse("2026-10-20T12:00:00Z") + minute * 60_000).toISOString(),
    draft_body: body,
    final_body: null,
    status: "pending" as const,
    ...over,
  });

  it("marks the newer of two near-duplicates only", () => {
    expect([...markNearDuplicates([item("old", 0), item("new", 4)])]).toEqual(["new"]);
    expect([...markNearDuplicates([item("new", 4), item("old", 0)])]).toEqual(["new"]);
  });

  it("marks nothing for unrelated items", () => {
    const other = item("b", 1, { recipient: "bo@example.com", draft_body: "something else entirely" });
    expect(markNearDuplicates([item("a", 0), other]).size).toBe(0);
  });

  it("marks the two newer of three near-identical items", () => {
    expect([...markNearDuplicates([item("a", 0), item("b", 5), item("c", 10)])].sort()).toEqual(["b", "c"]);
  });

  it("ignores items that are no longer pending", () => {
    expect(markNearDuplicates([item("a", 0), item("b", 3, { status: "approved" })]).size).toBe(0);
  });

  it("compares the edited text when there is one", () => {
    expect(markNearDuplicates([item("a", 0), item("b", 3, { final_body: "a completely different final text" })]).size).toBe(0);
  });

  it("does not reorder or mutate its input", () => {
    const items = [item("b", 4), item("a", 0)];
    const snapshot = JSON.stringify(items);
    markNearDuplicates(items);
    expect(JSON.stringify(items)).toBe(snapshot);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });

  it("returns a set of ids", () => {
    expect(markNearDuplicates([])).toBeInstanceOf(Set);
  });
});

describe("auditDraft (H9)", () => {
  const ctx: AuditContext = { type: "CLIENT_EMAIL", signOff: "Rebecca P. Beliard, Esq.", teamSignOff: "The RPB Law Team", memberNames: ["Rebecca Beliard", "Dawn Alvarez", "Amore Diaz"] };
  const codes = (body: string, c = ctx) => auditDraft(body, c).map((i) => `${i.code}:${i.level}`);
  const SIGNED = "\n\nBest,\nRebecca P. Beliard, Esq.";

  it("a clean body returns no issues", () => {
    expect(auditDraft(`Hi Ana,\n\nThanks for the call.${SIGNED}`, ctx)).toEqual([]);
  });

  it("banner, worksheet and placeholder are errors for a client email", () => {
    expect(codes(`NOT SENT\nHi${SIGNED}`)).toContain("banner:error");
    expect(codes(`Hi\nHard Rule 2: no fees${SIGNED}`)).toContain("worksheet:error");
    expect(codes(`Hi [confirm the address]${SIGNED}`)).toContain("placeholder:error");
    expect(codes(`Dear [Your name],${SIGNED}`)).toContain("placeholder:error");
  });

  it("a signature naming another firm member is an error", () => {
    const issues = auditDraft("Hi Ana,\n\nBest,\nDawn Alvarez", ctx);
    expect(issues.find((i) => i.code === "other-signer")).toMatchObject({ level: "error" });
    expect(issues[0].message).toContain("Dawn Alvarez");
  });

  it("the first name alone is enough to name a member", () => {
    expect(codes("Hi\n\nThanks,\nDawn")).toContain("other-signer:error");
  });

  it("a colleague who shares the sign-off's surname is still an error, not just a warning", () => {
    const c = { ...ctx, memberNames: ["Rebecca Beliard", "Dawn Beliard"] };
    expect(codes("Hi\n\nBest,\nDawn Beliard", c)).toContain("other-signer:error");
    expect(codes(`Hi${SIGNED}`, c)).toEqual([]);
  });

  it("a block that is neither sign-off but names no member is a warning", () => {
    expect(codes("Hi\n\nBest,\nSomeone From Accounts")).toEqual(["unverified-signer:warning"]);
  });

  it("the firm's own sign-off and the team sign-off are fine, and so is the signer's first name", () => {
    expect(codes("Hi\n\nBest,\nThe RPB Law Team")).toEqual([]);
    expect(codes("Hi\n\nBest,\nRebecca")).toEqual([]);
  });

  it("a member whose name is in the configured sign-off is not flagged for signing with it", () => {
    expect(codes(`Hi${SIGNED}`)).toEqual([]);
  });

  it("when the member list couldn't be read the signer check is reported as not run", () => {
    const issues = auditDraft("Hi\n\nBest,\nDawn", { ...ctx, memberNames: null });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: "signer-unchecked", level: "warning" });
    expect(issues[0].message).toContain("couldn't check");
  });

  it("with no sign-off set the signer can't be judged: a warning, not a refusal", () => {
    const issues = auditDraft("Hi\n\nBest,\nDawn Alvarez", { ...ctx, signOff: null });
    expect(issues.map((i) => i.level)).toEqual(["warning"]);
  });

  it("the pure checks still run when the member list is unavailable", () => {
    expect(codes("NOT SENT\nHi\n\nBest,\nDawn", { ...ctx, memberNames: null })).toContain("banner:error");
  });

  it("Markdown marks are a warning for a client email: bold, heading, table separator, backticks", () => {
    for (const text of ["It is **important**.", "# Next steps", "| a | b |\n|---|:-:|\n| 1 | 2 |", "Use `code` here"]) {
      expect(codes(`Hi\n${text}${SIGNED}`)).toEqual(["markdown-marks:warning"]);
    }
  });

  it("plain '-' bullets and ordinary punctuation do not trigger it", () => {
    expect(auditDraft(`Hi\n- one\n- two\n\nCost: 3 * 4 = 12 | done${SIGNED}`, ctx)).toEqual([]);
  });

  it("for any other type nothing is an error, and Markdown is not flagged", () => {
    const issues = auditDraft("# Letter DRAFT\nNOT SENT\nHard Rule 2: x\nClass: [confirm from the report]\n**bold**\n\nBest,\nDawn Alvarez", { ...ctx, type: "OPINION_LETTER" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.level === "warning")).toBe(true);
    expect(issues.some((i) => i.code === "markdown-marks" || i.code === "other-signer")).toBe(false);
  });

  it("messages are plain sentences and none gives legal advice", () => {
    const issues = auditDraft("NOT SENT\nRule 2: x\n[confirm y]\n**b**\n\nBest,\nDawn Alvarez", ctx);
    for (const i of issues) {
      expect(i.message.endsWith(".")).toBe(true);
      expect(i.message).not.toMatch(/\b(legal advice|you should sue|guarantee)\b/i);
    }
  });

  it("approvalBlock refuses only on errors, with one sentence", () => {
    expect(approvalBlock(auditDraft(`Hi **there**${SIGNED}`, ctx))).toBeNull();
    const blocked = approvalBlock(auditDraft(`NOT SENT\nHi${SIGNED}`, ctx));
    expect(blocked).toContain("can't be approved yet");
    expect(blocked).toContain("banner");
  });

  it("movedSummary lists what was taken out", () => {
    expect(movedSummary([])).toBe("");
    expect(movedSummary(["a", "b"])).toBe("Moved out of the draft:\n- a\n- b");
  });
});

describe("never throws and stays fast on hostile input (Q3)", () => {
  const big = (unit: string) => unit.repeat(Math.ceil(200_000 / unit.length)).slice(0, 200_000);
  const shapes: Record<string, string> = {
    prose: big("The quick brown fox jumps over the lazy dog. "),
    brackets: big("[confirm "),
    closedBrackets: big("[confirm x] "),
    stars: big("*"),
    pipes: big("|---"),
    dashes: big("-"),
    hashes: big("#"),
    ticks: big("`a"),
    newlines: big("\n"),
    banner: big("NOT SENT\n"),
    rules: big("Hard Rule 1: x\n"),
    oneLongLine: `NOT SENT ${"word ".repeat(40_000)}`,
    thanks: big("Thanks,\nDawn\n"),
    emoji: big("⚠️ "),
    spaces: big(" "),
  };

  for (const [name, text] of Object.entries(shapes)) {
    it(`cleans, audits and compares a 200,000 character '${name}' body in under a second`, () => {
      const start = performance.now();
      cleanDraftBody(text);
      enforceSignOff(text, { signOff: "Rebecca" });
      auditDraft(text, { type: "CLIENT_EMAIL", signOff: "Rebecca", memberNames: ["Dawn Alvarez"] });
      isNearDuplicate({ type: "t", recipient: "a", createdAt: 0, body: text }, { type: "t", recipient: "a", createdAt: 0, body: text });
      expect(performance.now() - start).toBeLessThan(1000);
    });
  }

  it("odd inputs do not throw", () => {
    for (const text of ["", "\n", "\r\n", "\u0000", "[", "]", "[]", "---", "Best,", "Best,\n", "🙂", "\uD800"]) {
      expect(() => {
        cleanDraftBody(text);
        enforceSignOff(text, { signOff: "R" });
        auditDraft(text, { type: "CLIENT_EMAIL" });
      }).not.toThrow();
    }
  });
});

describe("purity (Q4)", () => {
  it("imports nothing from the server", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/queue/hygiene.ts", "utf8");
    expect(src).not.toMatch(/server-only|fetch\(|@\/lib\/db|from "react"/);
    expect(src).not.toMatch(/^import /m);
  });
});
