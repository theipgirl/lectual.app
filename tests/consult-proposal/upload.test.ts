import { describe, it, expect } from "vitest";
import { Document, Packer, Paragraph, TextRun } from "docx";
import { transcriptFromUpload, MAX_TRANSCRIPT_FILE_BYTES } from "@/lib/consult-proposal/upload";
import { MAX_PASTED_TRANSCRIPT_CHARS } from "@/lib/consult-proposal/types";

const bytes = (s: string) => new TextEncoder().encode(s);

const VTT = `WEBVTT

NOTE this is a note
that spans two lines

1
00:00:01.000 --> 00:00:03.000
Rebecca: Thanks for joining the call today.

2
00:00:03.500 --> 00:00:06.000
Ana: Happy to be here. We want to protect Prosperall.
We also have a logo.

intro-cue
00:00:07.000 --> 00:00:09.000
<v Rebecca>A word mark and a logo mark then.</v>
`;

const SRT = `1
00:00:01,000 --> 00:00:03,000
Rebecca: Thanks for joining the call today.

2
00:00:03,500 --> 00:00:06,000
Ana: Happy to be here. We want to protect Prosperall.
We also have a logo.
`;

describe("transcriptFromUpload", () => {
  it(".vtt drops the header, notes, cue numbers, ids and timestamps but keeps the speaker lines", async () => {
    const r = await transcriptFromUpload("call.vtt", bytes(VTT));
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.text).not.toContain("-->");
    expect(r.text).not.toContain("WEBVTT");
    expect(r.text).not.toContain("this is a note");
    expect(r.text).not.toContain("intro-cue");
    expect(r.text.split("\n")).toEqual([
      "Rebecca: Thanks for joining the call today.",
      "Ana: Happy to be here. We want to protect Prosperall. We also have a logo.",
      "Rebecca: A word mark and a logo mark then.",
    ]);
  });

  it(".srt behaves the same", async () => {
    const r = await transcriptFromUpload("call.SRT", bytes(SRT));
    expect(r).toEqual({
      ok: true,
      text: "Rebecca: Thanks for joining the call today.\nAna: Happy to be here. We want to protect Prosperall. We also have a logo.",
    });
  });

  it("copes with CRLF line endings and a byte-order mark", async () => {
    const r = await transcriptFromUpload("call.srt", bytes(`﻿${SRT.replace(/\n/g, "\r\n")}`));
    expect(r.ok && r.text.startsWith("Rebecca: Thanks")).toBe(true);
    expect(r.ok && r.text).not.toMatch(/\r/);
  });

  it(".txt passes through, minus NUL bytes", async () => {
    const r = await transcriptFromUpload("notes.txt", bytes("Rebecca: Hello\0 there.\r\nAna: Hi.\n"));
    expect(r).toEqual({ ok: true, text: "Rebecca: Hello there.\nAna: Hi." });
  });

  it(".docx is extracted through mammoth", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("Rebecca: We recommend a word mark.")] }),
            new Paragraph({ children: [new TextRun("Ana: And the logo too.")] }),
          ],
        },
      ],
    });
    const buffer = await Packer.toBuffer(doc);
    const r = await transcriptFromUpload("call.docx", new Uint8Array(buffer));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("Rebecca: We recommend a word mark.");
    expect(r.text).toContain("Ana: And the logo too.");
  });

  it("refuses a .docx that is not a Word file, with a sentence", async () => {
    const r = await transcriptFromUpload("call.docx", bytes("not a zip"));
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/couldn't be read/);
  });

  it.each(["scan.pdf", "run.exe", "noextension", "archive.txt.zip"])("refuses %s and names the accepted types", async (name) => {
    const r = await transcriptFromUpload(name, bytes("some text"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain(".txt, .vtt, .srt or .docx");
    expect(!r.ok && r.error.endsWith(".")).toBe(true);
  });

  it("refuses text over MAX_PASTED_TRANSCRIPT_CHARS", async () => {
    const r = await transcriptFromUpload("long.txt", bytes("a".repeat(MAX_PASTED_TRANSCRIPT_CHARS + 1)));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("too long");
    expect(await transcriptFromUpload("limit.txt", bytes("a".repeat(MAX_PASTED_TRANSCRIPT_CHARS)))).toMatchObject({ ok: true });
  });

  it("refuses a file over the byte cap without parsing it", async () => {
    const r = await transcriptFromUpload("big.txt", new Uint8Array(MAX_TRANSCRIPT_FILE_BYTES + 1).fill(97));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("too large");
  });

  it("refuses an empty file and a subtitle file with no speech", async () => {
    expect(await transcriptFromUpload("empty.txt", new Uint8Array(0))).toMatchObject({ ok: false });
    const r = await transcriptFromUpload("none.vtt", bytes("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n\n"));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("No text could be read");
  });

  it("reads a Windows-1252 text file rather than refusing it", async () => {
    const r = await transcriptFromUpload("old.txt", new Uint8Array([0x41, 0x6e, 0x61, 0x3a, 0x20, 0x93, 0x68, 0x69, 0x94]));
    expect(r).toEqual({ ok: true, text: "Ana: “hi”" });
  });
});
