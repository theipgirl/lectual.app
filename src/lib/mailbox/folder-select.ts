/**
 * The compact folder + mailbox picker a phone gets in place of the sidebar. Pure: the page passes the
 * hrefs it already built for the sidebar links, so the select and the links cannot disagree.
 */
export type MailNavLink = { key: string; group: "Folders" | "Mailboxes"; label: string; href: string; current: boolean };

export type FolderSelect = {
  options: { group: MailNavLink["group"]; label: string; href: string }[];
  /** The href of the option that reads as the current place (the open folder, named with its mailbox). */
  value: string;
};

/** Folder options say which mailbox they are showing ("Received (all mailboxes)"), so the closed select reads fully. */
export function folderSelect(links: readonly MailNavLink[]): FolderSelect {
  const mailbox = links.find((l) => l.group === "Mailboxes" && l.current)?.label ?? "All mailboxes";
  const suffix = mailbox === "All mailboxes" ? "all mailboxes" : mailbox;
  const options = links.map((l) => ({ group: l.group, label: l.group === "Folders" ? `${l.label} (${suffix})` : l.label, href: l.href }));
  const folder = links.find((l) => l.group === "Folders" && l.current) ?? links.find((l) => l.group === "Folders");
  return { options, value: folder?.href ?? "" };
}
