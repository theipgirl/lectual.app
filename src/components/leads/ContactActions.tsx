import { contactLinks } from "@/lib/leads/status-row";

/** Phone-only Call / Email row in the lead header: a link only for a value the lead really has. */
export function ContactActions({ phone, email }: { phone: string | null; email: string | null }) {
  const links = contactLinks({ phone, email });
  if (!links.call && !links.email) return null;
  return (
    <div className="lx-contact-actions">
      {links.call && (
        <a className="lx-btn lx-btn-sm" href={links.call}>
          Call
        </a>
      )}
      {links.email && (
        <a className="lx-btn lx-btn-sm" href={links.email}>
          Email
        </a>
      )}
    </div>
  );
}
