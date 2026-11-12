/** What a letter-PDF server action returns: base64 bytes and a filename, or a fixed sentence. Never raw error text. */
export type LetterPdfResult =
  | {
      ok: true;
      base64: string;
      filename: string;
      /** Signed copy only: true when the file was produced from the stored signed text instead of being rebuilt (see `signed-pdf.ts`). */
      fromStoredText?: boolean;
    }
  | { ok: false; message: string };
