import Link from "next/link";
import { loadSetupState } from "@/lib/setup/load";
import { setupChecklist } from "@/lib/setup/checklist";
import type { SetupChecklist } from "@/lib/setup/types";
import { canSeeSetup } from "@/lib/setup/roles";
import { SETUP_PATH } from "@/lib/setup/routes";
import "./setup.css";

/**
 * "Finish setting up · N of 10" on Today. Owner, admin and senior admin only,
 * and gone once all ten are done. It reads its own state, so a failed read
 * here can never blank Today: it shows the checklist with those items as
 * "couldn't be checked", never hides itself as if the firm had finished.
 * The role is passed in by the page (which already resolved it) and checked
 * again here with the one `canSeeSetup` rule, before anything is read.
 */
export async function FinishSetupCard({ role }: { role: string | null | undefined }) {
  if (!canSeeSetup(role)) return null;
  let checklist;
  try {
    checklist = setupChecklist(await loadSetupState());
  } catch {
    return null;
  }
  if (checklist.complete) return null;
  return <FinishSetupView checklist={checklist} />;
}

/** The card itself, for a checklist that has items left. `GetSetUpCard` reads once and draws this or Getting started. */
export function FinishSetupView({ checklist }: { checklist: SetupChecklist }) {
  // A step only Lectual can switch on is never "next" for the firm.
  const next = checklist.items.find((i) => i.status !== "done" && !(i.owner === "lectual" && i.status === "to-do"));
  const unchecked = checklist.items.filter((i) => i.status === "couldnt-check").length;
  return (
    <section className="lx-card su-card" aria-labelledby="finish-setup-h">
      <div className="su-card-main">
        <h2 id="finish-setup-h" className="lx-h2 su-card-title">
          {`Finish setting up · ${checklist.doneCount} of ${checklist.total}`}
        </h2>
        {next && <p className="lx-sub" style={{ margin: 0 }}>{`Next: ${next.label}`}</p>}
        {unchecked > 0 && (
          <p className="lx-note" style={{ margin: 0, color: "var(--warn)" }}>
            {`${unchecked} couldn't be checked`}
          </p>
        )}
      </div>
      <Link href={SETUP_PATH} className="lx-btn lx-btn-pri lx-btn-sm">
        Continue setup
      </Link>
    </section>
  );
}
