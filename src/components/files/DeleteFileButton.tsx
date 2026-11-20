"use client";

import { useState, useTransition } from "react";
import { InlineConfirm, Notice } from "@/components/ui";
import { DELETE } from "@/lib/ui/words";
import "./files.css";
import { deleteFileAction } from "@/app/dashboard/files/actions";

/**
 * Delete for one stored file (owner, admin and senior_admin; the page shows it
 * only to them and the action checks again). It asks first, naming the file, and
 * nothing is removed until "Yes, delete". `defaultOpen` shows the question
 * straight away (used by the render tests).
 */
export function DeleteFileButton({ fileId, name, defaultOpen = false, onDeleted }: { fileId: string; name: string; defaultOpen?: boolean; onDeleted?: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    start(async () => {
      setError(null);
      try {
        const result = await deleteFileAction(fileId);
        if (!result.ok) return setError(result.error);
        // deleteFileAction revalidates the record's page (and the review); a page that isn't the record's own refreshes itself.
        onDeleted?.();
      } catch {
        setError("Couldn't delete that file just now. Try again shortly.");
      }
    });
  }

  return (
    <span className="fl-delete">
      <InlineConfirm
        label={DELETE}
        question={`Delete ${name}? The stored file is removed for good.`}
        pending={pending}
        initial={defaultOpen ? "asking" : "idle"}
        onConfirm={remove}
      />
      {error && (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      )}
    </span>
  );
}
