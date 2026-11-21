"use client";

import { useRouter } from "next/navigation";
import type { FileParentInput } from "@/lib/files/guard";
import { UploadControl } from "./UploadControl";

/**
 * The Documents & files card's own upload control (same request, browser PUT, confirm), for a page that is not the
 * record's own: the confirm action revalidates the lead or matter page, not this one, so it refreshes itself here (the
 * Weekly review's opened card: its list and the "N documents" tags then show the new file).
 */
export function UploadAndRefresh({ parent }: { parent: FileParentInput }) {
  const router = useRouter();
  return <UploadControl parent={parent} inputId="rv-file-input" onUploaded={() => router.refresh()} />;
}
