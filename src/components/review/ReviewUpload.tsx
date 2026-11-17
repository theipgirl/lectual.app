"use client";

import { useRouter } from "next/navigation";
import { UploadControl } from "@/components/files/UploadControl";
import type { FileParentInput } from "@/lib/files/guard";

/**
 * The Documents & files card's own upload control (same request, browser PUT, confirm), inside the review panel.
 * The record's page is revalidated by the confirm action, but the review is a different page, so it refreshes
 * itself here: the panel's list and the "N documents" tags then show the new file.
 */
export function ReviewUpload({ parent }: { parent: FileParentInput }) {
  const router = useRouter();
  return <UploadControl parent={parent} inputId="rv-file-input" onUploaded={() => router.refresh()} />;
}
