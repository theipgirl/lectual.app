"use client";

import type { ProposalInclude } from "@/lib/proposals/types";
import { saveProposalSettingsAction } from "@/app/dashboard/settings/proposals/actions";
import { ActionForm, Outcome } from "./ActionForm";
import { IncludesFields } from "./IncludesFields";

export type SettingsMember = { userId: string; name: string; email: string | null; role: string };

export type SettingsValues = {
  approverUserIds: string[];
  defaultPayUrl: string;
  notifyEmail: string;
  officeActionNote: string;
  includes: ProposalInclude[];
};

/** Approvers, links and the standard includes table. Admins only (the action re-checks). The package prices are their own card, `PackagePricesForm`. */
export function SettingsForm({ members, values }: { members: SettingsMember[]; values: SettingsValues }) {
  return (
    <ActionForm action={saveProposalSettingsAction} className="pe-settings">
      {({ state, pending }) => (
        <>
          <section className="lx-card pe-card">
            <header className="pe-card-head">
              <h2 className="pe-h">Who can approve</h2>
              <p className="lx-note pe-hint">
                Only these people can approve a proposal, and nothing reaches a client until one of them has. The database enforces this; owners and admins who aren’t listed can’t approve. Up to 10.
              </p>
            </header>
            <div className="pe-approvers">
              {members.map((m) => (
                <label key={m.userId} className="pe-check pe-approver">
                  <input type="checkbox" name="approver" value={m.userId} defaultChecked={values.approverUserIds.includes(m.userId)} />
                  <span>
                    {m.name}
                    {m.email && m.email !== m.name && <span className="lx-note"> · {m.email}</span>}
                    <span className="lx-note"> · {m.role.replace(/_/g, " ")}</span>
                  </span>
                </label>
              ))}
              {members.length === 0 && <p className="lx-note">Your team couldn’t be listed.</p>}
            </div>
          </section>

          <section className="lx-card pe-card">
            <header className="pe-card-head">
              <h2 className="pe-h">Links and notifications</h2>
            </header>
            <div className="lx-form-grid">
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Default pay link (https)</span>
                <input className="lx-input" name="defaultPayUrl" type="url" maxLength={2000} defaultValue={values.defaultPayUrl} placeholder="https://" />
                <span className="lx-note">New proposals start with this link. Each proposal can use a different one.</span>
              </label>
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Tell this address when a client accepts</span>
                <input className="lx-input" name="notifyEmail" type="email" maxLength={320} defaultValue={values.notifyEmail} />
              </label>
            </div>
          </section>

          <section className="lx-card pe-card">
            <header className="pe-card-head">
              <h2 className="pe-h">Standard “what’s included” table</h2>
              <p className="lx-note pe-hint">Copied into each new proposal, where it can be edited. The substantive office action response is never listed.</p>
            </header>
            <IncludesFields initial={values.includes} editable />
            <label className="lx-field" style={{ marginTop: 14 }}>
              <span className="lx-label">Standard office action note</span>
              <textarea className="lx-input" name="officeActionNote" rows={3} maxLength={4000} defaultValue={values.officeActionNote} />
            </label>
          </section>

          <div className="pe-save">
            <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
              {pending ? "Saving…" : "Save proposal settings"}
            </button>
            <Outcome state={state} pending={pending} />
          </div>
        </>
      )}
    </ActionForm>
  );
}
