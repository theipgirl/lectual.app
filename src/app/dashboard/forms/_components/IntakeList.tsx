"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createIntakeFormAction, duplicateIntakeFormAction, setIntakeArchivedAction } from "../actions";
import { IntakeQrButton } from "./IntakeQr";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { NOT_LIVE_MESSAGE, shareState } from "@/lib/intake-forms/share";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { EmptyState, Notice, PageHeader, Pill } from "@/components/ui";
import { BLANK, FORMS_NAME } from "@/lib/ui/words";

/**
 * Intake → Forms, the list: every intake the firm keeps (one per event,
 * campaign or page), with its link, source tag and the last 30 days' numbers,
 * and the actions that make a new one (New, Duplicate) or retire it
 * (Archive). Editing opens the intake's own page.
 *
 * Numbers are passed in already read. `stats: null` means the read failed,
 * and every row then says "—", never 0.
 */

export type IntakeListItem = {
  id: string;
  name: string;
  slug: string;
  url: string;
  sourceTag: string | null;
  kind: "intake" | "assessment";
  status: "draft" | "live" | "archived";
  stats: { captured: number; completed: number; unfinished: number; median: string; rate: string } | null;
};

export function IntakeList({
  items,
  canEdit,
  statsFailed,
}: {
  items: IntakeListItem[];
  canEdit: boolean;
  statsFailed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: true; id: string } | { ok: false; error: string }>, open: boolean) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (open) router.push(`/dashboard/forms/?form=${encodeURIComponent(res.id)}`);
      else router.refresh();
    });
  };

  const create = (kind: "intake" | "assessment") => run(() => createIntakeFormAction(newName, kind), true);

  const copy = (url: string, id: string) => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(id);
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
      },
      () => setError("Couldn't copy. Open the form and copy its link from there."),
    );
  };

  const active = items.filter((i) => i.status !== "archived");
  const archived = items.filter((i) => i.status === "archived");
  const shown = showArchived ? [...active, ...archived] : active;

  return (
    <div className="ifl-root">
      <PageHeader
        title={FORMS_NAME}
        tour="forms-head"
        sub="One per event, campaign or page: a form or a scored assessment. Each has its own link, QR code, source tag and numbers."
        actions={
          canEdit ? (
            <form
              className="ifl-new ifl-create"
              onSubmit={(e) => {
                e.preventDefault();
                create("intake");
              }}
            >
              <input
                className="lx-input"
                value={newName}
                maxLength={120}
                placeholder="Name it, e.g. UGW 2026 booth"
                aria-label="New form name"
                onChange={(e) => setNewName(e.target.value)}
              />
              <div className="ifl-create-row">
                <div>
                  <button type="submit" data-kind="intake" className="lx-btn lx-btn-pri" disabled={pending || !newName.trim()}>
                    New form
                  </button>
                  <span className="ifl-create-hint">A chat or form that collects contact details and answers.</span>
                </div>
                <div>
                  <button type="button" data-kind="assessment" className="lx-btn lx-btn-sec" disabled={pending || !newName.trim()} onClick={() => create("assessment")}>
                    New scored assessment (for events)
                  </button>
                  <span className="ifl-create-hint">A short scored quiz for a booth or event, with a result for the person.</span>
                </div>
              </div>
            </form>
          ) : undefined
        }
      />

      {error && (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      )}
      {statsFailed && (
        <Notice tone="warn" role="status">
          The numbers couldn&apos;t be loaded just now. Refresh to try again.
        </Notice>
      )}

      <div className="ifl-list">
        {shown.map((i) => (
          <article key={i.id} className={`lx-card ifl-item${i.status === "archived" ? " archived" : ""}`}>
            <div className="ifl-main">
              <div className="ifl-title-row">
                <Link href={`/dashboard/forms/?form=${encodeURIComponent(i.id)}`} className="ifl-name">
                  {i.name}
                </Link>
                <Pill tone={i.status === "live" ? "ok" : "mute"}>{i.status === "live" ? "Live" : i.status === "archived" ? "Archived" : "Draft"}</Pill>
                <Pill>{i.kind === "assessment" ? "Assessment" : "Chat or form"}</Pill>
                {i.sourceTag && <Pill tone="ox">{i.sourceTag}</Pill>}
              </div>
              <div className="ifl-link">
                {shareState(i.status).canShare ? (
                  <>
                    <span>{i.url.replace(/^https?:\/\//, "")}</span>
                    <button type="button" className="lx-link ifl-copy" onClick={() => copy(i.url, i.id)}>
                      {copied === i.id ? "Copied" : "Copy link"}
                    </button>
                  </>
                ) : (
                  <>
                    <span id={`ifl-notlive-${i.id}`} className="ifl-notlive">
                      {NOT_LIVE_MESSAGE}
                    </span>
                    <button type="button" className="lx-link ifl-copy" disabled aria-describedby={`ifl-notlive-${i.id}`}>
                      Copy link
                    </button>
                  </>
                )}
              </div>
            </div>
            <dl className="ifl-stats" aria-label="Last 30 days">
              <div>
                <dt>Gave details</dt>
                <dd>{i.stats ? i.stats.captured.toLocaleString("en-US") : BLANK}</dd>
              </div>
              <div>
                <dt>Finished</dt>
                <dd>
                  {i.stats ? i.stats.completed.toLocaleString("en-US") : BLANK}
                  {i.stats && i.stats.captured > 0 && <small> {i.stats.rate}</small>}
                </dd>
              </div>
              <div>
                <dt>Didn&apos;t finish</dt>
                <dd>{i.stats ? i.stats.unfinished.toLocaleString("en-US") : BLANK}</dd>
              </div>
              <div>
                <dt>Typical time (median)</dt>
                <dd>{i.stats ? i.stats.median : BLANK}</dd>
              </div>
            </dl>
            <div className="ifl-actions">
              <Link className="lx-btn lx-btn-sm lx-btn-ghost" href={`/dashboard/forms/?form=${encodeURIComponent(i.id)}`}>
                {canEdit ? "Edit" : "View"}
              </Link>
              <Link className="lx-btn lx-btn-sm lx-btn-ghost" href={`/dashboard/forms/?form=${encodeURIComponent(i.id)}&tab=results`}>
                Results
              </Link>
              <Link className="lx-btn lx-btn-sm lx-btn-ghost" href={`/dashboard/forms/?form=${encodeURIComponent(i.id)}&tab=performance`}>
                Performance
              </Link>
              <IntakeQrButton url={i.url} name={i.name} slug={i.slug} compact shareable={shareState(i.status).canShare} describedBy={`ifl-notlive-${i.id}`} />
              {canEdit && (
                <>
                  <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost" disabled={pending} onClick={() => run(() => duplicateIntakeFormAction(i.id), true)}>
                    Duplicate
                  </button>
                  {i.status === "archived" ? (
                    <button type="button" className="lx-btn lx-btn-sm lx-btn-ghost" disabled={pending} onClick={() => run(() => setIntakeArchivedAction(i.id, false), false)}>
                      Restore
                    </button>
                  ) : (
                    <InlineConfirm
                      label="Archive"
                      question={`Archive “${i.name}”? Its link stops taking new people. Its leads and numbers are kept.`}
                      confirmLabel="Archive"
                      className="lx-btn lx-btn-sm lx-btn-ghost"
                      pending={pending}
                      onConfirm={() => run(() => setIntakeArchivedAction(i.id, true), false)}
                    />
                  )}
                </>
              )}
            </div>
          </article>
        ))}
        {shown.length === 0 && (
          <EmptyState variant="line">
            {canEdit ? "No forms yet. Name one above to start." : `No forms yet. ${ADMIN_TIER_PHRASE} can set them up.`}
          </EmptyState>
        )}
      </div>

      {archived.length > 0 && (
        <button type="button" className="ifl-toggle" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Hide archived" : `Show ${archived.length} archived`}
        </button>
      )}
      <p className="ifm-help">The figures are for the last 30 days. Open a form&apos;s Results or Performance for other ranges and the people behind them.</p>
    </div>
  );
}
