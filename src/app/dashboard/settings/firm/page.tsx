import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getOrgProfile } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE, timeZoneOptions } from "@/lib/org/profile-rules";
import { FirmProfileForm } from "@/components/settings/FirmProfileForm";

export const dynamic = "force-dynamic";

export default async function FirmProfilePage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  let profile = null;
  let loadError = false;
  try {
    profile = await getOrgProfile();
  } catch {
    loadError = true;
  }

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1">Firm profile</h1>
        <p className="lx-sub">How the firm appears on the drafts Lectual prepares for you.</p>
      </div>
      {loadError ? (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load the firm profile. Try again shortly.
        </div>
      ) : (
        <FirmProfileForm
          firmName={session.org.name}
          displayName={profile?.display_name ?? null}
          timeZone={profile?.time_zone ?? DEFAULT_TIME_ZONE}
          signature={profile?.email_signature ?? null}
          zones={timeZoneOptions()}
          canEdit={hasRole(session.role, "senior_admin")}
        />
      )}
      <p className="lx-note" style={{ margin: 0 }}>
        The firm&apos;s account name ({session.org.name}) and its web address are set by Lectual. Ask us to change them.
      </p>
    </>
  );
}
