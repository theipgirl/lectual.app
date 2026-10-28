import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getOrgProfile } from "@/lib/org/profile";
import { DEFAULT_TIME_ZONE, timeZoneOptions } from "@/lib/org/profile-rules";
import { FirmProfileForm } from "@/components/settings/FirmProfileForm";
import { listSequences } from "@/lib/automation/drips";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { FeedbackLink } from "@/components/feedback/SendFeedbackButton";

export const metadata: Metadata = { title: pageTitle("Firm profile") };

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
  // The nurture-campaign picker. A failed read says so on the form rather
  // than offering an empty list that reads as "this firm has no campaigns".
  let campaigns: { id: string; name: string }[] = [];
  let campaignsFailed = false;
  try {
    campaigns = (await listSequences()).map((s) => ({ id: s.id, name: s.name }));
  } catch {
    campaignsFailed = true;
  }

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1" data-tour="firm-head">Firm profile</h1>
        <p className="lx-sub">How the firm appears on the drafts Lectual prepares for you, and where each temperature&apos;s next step points.</p>
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
          strategySessionUrl={profile?.strategy_session_url ?? null}
          discoveryCallUrl={profile?.discovery_call_url ?? null}
          nurtureSequenceId={profile?.nurture_sequence_id ?? null}
          campaigns={campaigns}
          campaignsFailed={campaignsFailed}
          zones={timeZoneOptions()}
          canEdit={hasRole(session.role, "senior_admin")}
        />
      )}
      <p className="lx-note" style={{ margin: 0 }}>
        The firm&apos;s account name ({session.org.name}) and its web address are set by Lectual. <FeedbackLink>Ask us</FeedbackLink> to change them.
      </p>
    </>
  );
}
