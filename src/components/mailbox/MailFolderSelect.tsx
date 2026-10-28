"use client";

import { useRouter } from "next/navigation";
import type { FolderSelect } from "@/lib/mailbox/folder-select";

/** One compact select above the message list on a phone (the sidebar is hidden there); it goes to the same URLs as the sidebar links. */
export function MailFolderSelect({ select }: { select: FolderSelect }) {
  const router = useRouter();
  const groups = ["Folders", "Mailboxes"] as const;
  return (
    <label className="lx-mail-select">
      <span className="lx-mail-select-label">Folder and mailbox</span>
      <select className="lx-input" value={select.value} onChange={(e) => router.push(e.target.value)} aria-label="Folder and mailbox">
        {groups.map((group) => (
          <optgroup key={group} label={group}>
            {select.options
              .filter((o) => o.group === group)
              .map((o) => (
                <option key={o.href + o.label} value={o.href}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
