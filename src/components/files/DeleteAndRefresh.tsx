"use client";

import { useRouter } from "next/navigation";
import { DeleteFileButton } from "./DeleteFileButton";

/**
 * Delete for one stored file, for a page that is not the record's own (the Weekly review's opened card): like
 * `UploadAndRefresh`, it refreshes the page after a successful delete, so the list and the "N documents" tags drop the file.
 * A refused delete refreshes nothing and shows the action's fixed sentence.
 */
export function DeleteAndRefresh({ fileId, name }: { fileId: string; name: string }) {
  const router = useRouter();
  return <DeleteFileButton fileId={fileId} name={name} onDeleted={() => router.refresh()} />;
}
