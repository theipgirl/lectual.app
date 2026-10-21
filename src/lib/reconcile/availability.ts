/**
 * What can be said about each source before a sheet is uploaded. Pure: the page reads the two
 * connections and hands the results here. A failed check is "couldn't check", never "not connected".
 */

export type Availability = Array<{
  source: "sheet" | "lawmatics" | "email";
  label: string;
  tone: "ok" | "warn" | "pending";
  text: string;
}>;

export type ConnectionCheck = { ok: true; active: number } | { ok: false };

export function describeAvailability(lawmatics: ConnectionCheck, mailboxes: ConnectionCheck): Availability {
  return [
    { source: "sheet", label: "Sheet", tone: "pending", text: "Waiting for your CSV file." },
    {
      source: "lawmatics",
      label: "Lawmatics",
      tone: lawmatics.ok && lawmatics.active > 0 ? "ok" : "warn",
      text: !lawmatics.ok
        ? "We couldn't check the connection. It will be tried when you upload."
        : lawmatics.active > 0
          ? "Connected. Its stages will be read, not changed."
          : "Not connected. The Lawmatics column will show as unavailable. Connect it in Settings, Integrations.",
    },
    {
      source: "email",
      label: "Email",
      tone: mailboxes.ok && mailboxes.active > 0 ? "ok" : "warn",
      text: !mailboxes.ok
        ? "We couldn't check the mailbox connections. Synced mail will be tried when you upload."
        : mailboxes.active > 0
          ? "Mailbox sync is connected. Mail already on each lead's timeline will be used."
          : "No mailbox is connected, so there may be no synced mail to use. That is not an error.",
    },
  ];
}
