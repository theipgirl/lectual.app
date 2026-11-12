/** What a letter-PDF server action returns: base64 bytes and a filename, or a fixed sentence. Never raw error text. */
export type LetterPdfResult = { ok: true; base64: string; filename: string } | { ok: false; message: string };
