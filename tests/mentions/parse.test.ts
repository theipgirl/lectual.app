import { describe, it, expect } from "vitest";
import {
  extractMentionCandidates,
  resolveMentions,
  renderSegments,
  type MentionDirectoryMember,
} from "@/lib/mentions/parse";

const DIRECTORY: MentionDirectoryMember[] = [
  { userId: "user-dawn", displayName: "Dawn Okafor" },
  { userId: "user-marisol", displayName: "Marisol Toussaint" },
  { userId: "user-noname", displayName: null }, // an unresolved-identity member — never matchable
];

describe("extractMentionCandidates", () => {
  it("finds a single-word candidate", () => {
    expect(extractMentionCandidates("Please review @Dawn before Friday.")).toEqual(["@Dawn"]);
  });

  it("finds a two-word candidate", () => {
    expect(extractMentionCandidates("Hey @Dawn Okafor, can you take this?")).toEqual([
      "@Dawn Okafor",
    ]);
  });

  it("finds more than one candidate, left to right", () => {
    expect(extractMentionCandidates("@Dawn and @Marisol should both see this.")).toEqual([
      "@Dawn",
      "@Marisol",
    ]);
  });

  it("never matches an email address — @ must start at a word boundary", () => {
    expect(extractMentionCandidates("Reach the founder at founder@Example.com.")).toEqual([]);
  });

  it("does not match a lowercase word after @ (picker always inserts a capitalized name)", () => {
    expect(extractMentionCandidates("cc @dawn on this")).toEqual([]);
  });

  it("returns nothing for text with no @", () => {
    expect(extractMentionCandidates("No mentions in this note at all.")).toEqual([]);
  });
});

describe("resolveMentions", () => {
  it("resolves a unique first name", () => {
    const { userIds, unresolved } = resolveMentions("cc @Dawn on this", DIRECTORY);
    expect(userIds).toEqual(["user-dawn"]);
    expect(unresolved).toEqual([]);
  });

  it("resolves a whole display name", () => {
    const { userIds } = resolveMentions("cc @Marisol Toussaint on this", DIRECTORY);
    expect(userIds).toEqual(["user-marisol"]);
  });

  it("matches case-insensitively", () => {
    const { userIds } = resolveMentions("cc @DAWN OKAFOR on this", DIRECTORY);
    expect(userIds).toEqual(["user-dawn"]);
  });

  it("is unresolved — never a guess — when two members share the candidate's first name", () => {
    const twoDawns: MentionDirectoryMember[] = [
      { userId: "user-dawn-1", displayName: "Dawn Okafor" },
      { userId: "user-dawn-2", displayName: "Dawn Ferreira" },
    ];
    const { userIds, unresolved } = resolveMentions("cc @Dawn on this", twoDawns);
    expect(userIds).toEqual([]);
    expect(unresolved).toEqual(["@Dawn"]);
  });

  it("is unresolved when the candidate matches nobody", () => {
    const { userIds, unresolved } = resolveMentions("cc @Ghost on this", DIRECTORY);
    expect(userIds).toEqual([]);
    expect(unresolved).toEqual(["@Ghost"]);
  });

  it("a two-word candidate does not fall back to first-name matching", () => {
    // "Dawn Chen" matches no whole name in the directory; it must not
    // silently resolve to "Dawn" — the second word was typed on purpose.
    const { userIds, unresolved } = resolveMentions("cc @Dawn Chen on this", DIRECTORY);
    expect(userIds).toEqual([]);
    expect(unresolved).toEqual(["@Dawn Chen"]);
  });

  it("dedupes repeated mentions of the same person", () => {
    const { userIds } = resolveMentions("@Dawn, did you see this? cc @Dawn again.", DIRECTORY);
    expect(userIds).toEqual(["user-dawn"]);
  });

  it("never matches a member with no resolved display name", () => {
    const { userIds, unresolved } = resolveMentions("cc @Noname on this", DIRECTORY);
    expect(userIds).toEqual([]);
    expect(unresolved).toEqual(["@Noname"]);
  });

  // The picker inserts "@" + the member's real display_name, whatever shape
  // that is. Anything it offers must resolve, or the author is told a teammate
  // was tagged and the teammate is never notified.
  it("resolves a three-part display name the picker itself inserts", () => {
    const withMiddle: MentionDirectoryMember[] = [
      { userId: "user-rebecca", displayName: "Rebecca P. Beliard" },
      ...DIRECTORY,
    ];
    const { userIds, unresolved } = resolveMentions(
      "@Rebecca P. Beliard can you review this?",
      withMiddle,
    );
    expect(userIds).toEqual(["user-rebecca"]);
    expect(unresolved).toEqual([]);
  });

  it("resolves a lowercase display name (0031's email-local-part fallback)", () => {
    const fromEmail: MentionDirectoryMember[] = [{ userId: "user-support", displayName: "support" }];
    const { userIds, unresolved } = resolveMentions("@support please check the specimen", fromEmail);
    expect(userIds).toEqual(["user-support"]);
    expect(unresolved).toEqual([]);
  });

  it("never reads a shorter display name out of a longer word", () => {
    const dawn: MentionDirectoryMember[] = [{ userId: "user-dawn", displayName: "Dawn" }];
    const { userIds, unresolved } = resolveMentions("cc @Dawnisha on this", dawn);
    expect(userIds).toEqual([]);
    expect(unresolved).toEqual(["@Dawnisha"]);
  });

  it("prefers the longest matching display name when one is a prefix of another", () => {
    const both: MentionDirectoryMember[] = [
      { userId: "user-short", displayName: "Dawn" },
      { userId: "user-long", displayName: "Dawn Okafor" },
    ];
    const { userIds } = resolveMentions("cc @Dawn Okafor on this", both);
    expect(userIds).toEqual(["user-long"]);
  });

  it("a note with no @ at all resolves nothing", () => {
    expect(resolveMentions("Just a plain note.", DIRECTORY)).toEqual({
      userIds: [],
      unresolved: [],
    });
  });
});

describe("renderSegments", () => {
  it("splits a resolved mention out as its own segment", () => {
    const segments = renderSegments("cc @Dawn on this", DIRECTORY);
    expect(segments).toEqual([
      { type: "text", value: "cc " },
      { type: "mention", value: "@Dawn", userId: "user-dawn" },
      { type: "text", value: " on this" },
    ]);
  });

  it("keeps an unresolved (ambiguous or unknown) mention as plain text", () => {
    const segments = renderSegments("cc @Ghost on this", DIRECTORY);
    expect(segments).toEqual([{ type: "text", value: "cc @Ghost on this" }]);
  });

  it("handles more than one resolved mention in the same text", () => {
    const segments = renderSegments("@Dawn and @Marisol should both see this.", DIRECTORY);
    expect(segments).toEqual([
      { type: "mention", value: "@Dawn", userId: "user-dawn" },
      { type: "text", value: " and " },
      { type: "mention", value: "@Marisol", userId: "user-marisol" },
      { type: "text", value: " should both see this." },
    ]);
  });

  it("highlights the whole of a multi-word display name, not its first word", () => {
    const withMiddle: MentionDirectoryMember[] = [
      { userId: "user-rebecca", displayName: "Rebecca P. Beliard" },
    ];
    expect(renderSegments("cc @Rebecca P. Beliard here", withMiddle)).toEqual([
      { type: "text", value: "cc " },
      { type: "mention", value: "@Rebecca P. Beliard", userId: "user-rebecca" },
      { type: "text", value: " here" },
    ]);
  });

  it("returns a single text segment for text with no mentions", () => {
    expect(renderSegments("Nothing to see here.", DIRECTORY)).toEqual([
      { type: "text", value: "Nothing to see here." },
    ]);
  });

  it("handles the empty string without producing an empty text segment array", () => {
    expect(renderSegments("", DIRECTORY)).toEqual([{ type: "text", value: "" }]);
  });
});
