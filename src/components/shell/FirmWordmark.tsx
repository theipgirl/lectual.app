import "./wordmark.css";
import { firmLogo } from "@/lib/org/logo";

/** The firm's logo file when one exists, else its name as text. */
export function FirmWordmark({ org }: { org: { id: string; name: string; slug?: string | null } }) {
  const logo = firmLogo(org.id, org.name, org.slug ?? undefined);
  if (!logo) return <>{org.name}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a small static brand file, not a content image
    <img src={logo.src} alt={logo.alt} className="lx-wordmark-logo" />
  );
}
