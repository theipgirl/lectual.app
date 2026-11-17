import Link from "next/link";
import { Pill } from "@/components/ui/Pill";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import type { PillTone } from "@/lib/ui/tones";
import type { AccountItem, AccountItemStatus, FirstUsers } from "@/lib/setup/first-users";
import { TEAM_ACCOUNTS_CANT_CHECK, TEAM_ACCOUNTS_NAME, TEAM_ACCOUNTS_NO_MEMBERS, TEAM_ACCOUNTS_PRIVATE_PILL, TEAM_ACCOUNTS_SUB, TEAM_ACCOUNTS_YOU, YOUR_SETUP_LABEL } from "@/lib/ui/words";
import "./setup.css";

/** Every status has its own words, so colour is never the only signal. */
export const ACCOUNT_PILL: Record<AccountItemStatus, { label: string; tone: PillTone }> = {
  done: { label: "Done", tone: "ok" },
  "to-do": { label: "To do", tone: "mute" },
  "couldnt-check": { label: "Couldn't check", tone: "warn" },
  private: { label: TEAM_ACCOUNTS_PRIVATE_PILL, tone: "mute" },
};

function ItemLine({ item }: { item: AccountItem }) {
  const pill = ACCOUNT_PILL[item.status];
  return (
    <li className="su-acct-item" data-item={item.id} data-status={item.status}>
      <span className="su-acct-label">{item.label}</span>
      <Pill tone={pill.tone}>{pill.label}</Pill>
      <span className="lx-note su-acct-text">
        {item.text}
        {item.href && item.status !== "done" ? (
          <>
            {" "}
            <Link href={item.href} className="lx-link">
              Open
            </Link>
          </>
        ) : null}
      </span>
    </li>
  );
}

/** Settings → Setup → Team accounts. Presentational: it only draws what it is given (the page has already gated the role). */
export function TeamAccountsView({ data }: { data: FirstUsers }) {
  return (
    <section className="lx-card su-accounts" aria-labelledby="su-accounts-h" data-section="team-accounts">
      <h2 id="su-accounts-h" className="lx-h2">
        {TEAM_ACCOUNTS_NAME}
      </h2>
      <p className="lx-sub su-accounts-sub">{TEAM_ACCOUNTS_SUB}</p>
      {data.status === "couldnt-check" ? (
        <LoadFailedLine>{TEAM_ACCOUNTS_CANT_CHECK}</LoadFailedLine>
      ) : data.rows.length === 0 ? (
        <p className="lx-note">{TEAM_ACCOUNTS_NO_MEMBERS}</p>
      ) : (
        <ul className="su-acct-list">
          {data.rows.map((r) => (
            <li key={r.userId} className="su-acct" data-user={r.userId}>
              <div className="su-acct-head">
                <span className="su-acct-name">{r.name}</span>
                {r.isYou ? <Pill tone="mute">{TEAM_ACCOUNTS_YOU}</Pill> : null}
                <span className="lx-note">{r.roleLabel}</span>
              </div>
              <ul className="su-acct-items">
                {r.items.map((i) => (
                  <ItemLine key={i.id} item={i} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Getting started: each person's own Outlook state, one quiet block. */
export function YourSetupView({ items }: { items: AccountItem[] }) {
  return (
    <section className="lx-card su-accounts su-yours" aria-labelledby="su-yours-h" data-section="your-setup">
      <h2 id="su-yours-h" className="lx-h3">
        {YOUR_SETUP_LABEL}
      </h2>
      <ul className="su-acct-items">
        {items.map((i) => (
          <ItemLine key={i.id} item={i} />
        ))}
      </ul>
    </section>
  );
}
