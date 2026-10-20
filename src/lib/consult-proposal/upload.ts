import { MAX_PASTED_TRANSCRIPT_CHARS } from "./types";

/**
 * A consult transcript from an uploaded file: `.txt`, `.vtt`, `.srt` or `.docx`.
 *
 * Pure apart from the `mammoth` import (`.docx` only). The file is read once,
 * its text is returned, and nothing is stored: the caller hands the text to the
 * same drafter a pasted transcript goes to. A refusal is one sentence written to
 * be shown, never a thrown error and never the file's own content.
 *
 * Subtitle files (`.vtt`, `.srt`) are what Zoom, Fathom and Teams export: cue
 * numbers, ids, timestamps, the WEBVTT header and NOTE blocks are dropped, and
 * the spoken lines are kept ("Rebecca: ..." stays as it is; a `<v Rebecca>`
 * voice tag becomes "Rebecca: ...").
 */

export const ACCEPTED_TRANSCRIPT_TYPES = ".txt, .vtt, .srt or .docx";

/** Read before parsing, so a huge file is never pulled into memory. Under Next's 1 MB server-action body default. */
export const MAX_TRANSCRIPT_FILE_BYTES = 1_000_000;

export type TranscriptFromUpload = { ok: true; text: string } | { ok: false; error: string };

const refuse = (error: string): TranscriptFromUpload => ({ ok: false, error });

const TIMESTAMP = /-->/;

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Windows-1252's printable 0x80-0x9F block (smart quotes, dashes); the rest of the code page is Latin-1. */
const CP1252_HIGH = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // An older editor's smart quotes: Windows-1252 rather than a refusal. Done by hand,
    // because Node builds without full ICU decode "windows-1252" as bare Latin-1.
    let out = "";
    for (const b of bytes) out += b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : String.fromCharCode(b);
    return out;
  }
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&quot;": '"', "&#39;": "'" };

/** One cue's text: voice tags become "Name: ", other markup is dropped. */
function cueText(raw: string): string {
  return raw
    .replace(/<v(?:\.[^\s>]*)?\s+([^>]+)>/gi, "$1: ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/<\d{1,2}:\d{2}[:.\d]*>/g, "")
    .replace(/&(?:amp|lt|gt|nbsp|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

/** WebVTT / SubRip -> the spoken lines, one per cue. */
function fromSubtitles(raw: string): string {
  const lines = raw.replace(/^﻿/, "").split("\n");
  const out: string[] = [];
  let inCue = false;
  let skipBlock = false;
  let current: string[] = [];
  const flush = () => {
    if (current.length > 0) {
      const text = cueText(current.join(" "));
      if (text) out.push(text);
    }
    current = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") {
      flush();
      inCue = false;
      skipBlock = false;
      continue;
    }
    if (skipBlock) continue;
    if (TIMESTAMP.test(line)) {
      flush();
      inCue = true;
      continue;
    }
    if (!inCue && (/^WEBVTT(\s|$)/.test(line) || /^(NOTE|STYLE|REGION)(\s|$)/.test(line))) {
      skipBlock = true;
      continue;
    }
    // A cue number or id sits directly above its timestamp line.
    const next = (lines[i + 1] ?? "").trim();
    if (TIMESTAMP.test(next)) {
      flush();
      continue;
    }
    if (inCue) current.push(line);
  }
  flush();
  return out.join("\n");
}

function tidy(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function transcriptFromUpload(name: string, bytes: Uint8Array): Promise<TranscriptFromUpload> {
  const ext = extensionOf(name);
  if (!["txt", "vtt", "srt", "docx"].includes(ext)) {
    return refuse(`That file type can't be used. Upload the transcript as a ${ACCEPTED_TRANSCRIPT_TYPES} file, or paste it.`);
  }
  if (!bytes || bytes.length === 0) return refuse("That file is empty.");
  if (bytes.length > MAX_TRANSCRIPT_FILE_BYTES) {
    return refuse(`That file is too large. The most that can be uploaded is ${Math.round(MAX_TRANSCRIPT_FILE_BYTES / 1_000_000)} MB; paste the text instead.`);
  }

  let text: string;
  if (ext === "docx") {
    try {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    } catch {
      return refuse("That Word file couldn't be read. Save it as a .docx again, or paste the transcript.");
    }
  } else {
    const normal = decodeText(bytes).replace(/\0/g, "").replace(/\r\n?/g, "\n");
    text = ext === "txt" ? normal : fromSubtitles(normal);
  }

  const result = tidy(text);
  if (!result) return refuse("No text could be read from that file.");
  if (result.length > MAX_PASTED_TRANSCRIPT_CHARS) {
    return refuse(`That transcript is too long. The most that can be used is ${MAX_PASTED_TRANSCRIPT_CHARS.toLocaleString("en-US")} characters.`);
  }
  return { ok: true, text: result };
}
