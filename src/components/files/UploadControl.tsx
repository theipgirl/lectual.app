"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { confirmUploadAction, requestUploadAction } from "@/app/dashboard/files/actions";
import type { FileParentInput } from "@/lib/files/guard";
import { FILE_MESSAGES, checkFileName, checkFileSize } from "@/lib/files/rules";
import { UploadView } from "./UploadView";

const NETWORK = "The upload didn't finish. Check your connection and try again.";

/**
 * Add a file to a lead or matter: request a signed upload URL, send the file
 * straight to storage, then confirm so the server records it. The checks here
 * (extension, size) only give quick feedback; the server repeats them. The
 * content type sent with the upload is the MIME the server mapped from the
 * extension (the bucket checks that header; a browser's own is empty or odd for
 * .msg, .eml and .heic). The browser only ever holds the signed URL, never a
 * storage path it could change.
 */
export function UploadControl({ parent }: { parent: FileParentInput }) {
  const router = useRouter();
  const [busyName, setBusyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputKey, setInputKey] = useState(0);

  async function upload(file: File) {
    const type = checkFileName(file.name);
    if (!type.ok) return setError(type.error);
    const size = checkFileSize(file.size);
    if (!size.ok) return setError(size.error);

    setError(null);
    setBusyName(file.name);
    try {
      const request = await requestUploadAction(parent, file.name, file.type, file.size);
      if (!request.ok) return setError(request.error);

      const sent = await fetch(request.signedUrl, {
        method: "PUT",
        headers: { "content-type": request.mime, "cache-control": "max-age=3600", "x-upsert": "false" },
        body: file,
      });
      if (!sent.ok) return setError(NETWORK);

      const saved = await confirmUploadAction(parent, request.fileId, file.name);
      if (!saved.ok) return setError(saved.error);
      router.refresh();
    } catch {
      setError(FILE_MESSAGES.generic);
    } finally {
      setBusyName(null);
      setInputKey((k) => k + 1); // clears the picker so the same file can be chosen again
    }
  }

  return <UploadView busy={busyName !== null} busyName={busyName} error={error} inputKey={inputKey} onPick={(file) => file && void upload(file)} />;
}
