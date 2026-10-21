"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteFileAction } from "@/app/dashboard/files/actions";

/**
 * Delete for one stored file (owner, admin and senior_admin; the page shows it
 * only to them and the action checks again). It asks first, naming the file, and
 * nothing is removed until "Yes, delete". `defaultOpen` shows the question
 * straight away (used by the render tests).
 */
export function DeleteFileButton({ fileId, name, defaultOpen = false }: { fileId: string; name: string; defaultOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(true)}>
        Delete
      </button>
    );
  }

  function remove() {
    start(async () => {
      setError(null);
      try {
        const result = await deleteFileAction(fileId);
        if (!result.ok) return setError(result.error);
        setOpen(false);
        router.refresh();
      } catch {
        setError("Couldn't delete that file just now. Try again shortly.");
      }
    });
  }

  return (
    <span className="lx-inline-form" style={{ flexWrap: "wrap" }}>
      <span className="lx-note" style={{ color: "var(--ink)" }}>
        {`Delete ${name}? The stored file is removed for good.`}
      </span>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" style={{ color: "var(--wine)" }} disabled={pending} onClick={remove}>
        {pending ? "Deleting…" : "Yes, delete"}
      </button>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} onClick={() => setOpen(false)}>
        Cancel
      </button>
      {error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
