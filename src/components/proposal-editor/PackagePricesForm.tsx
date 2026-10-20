"use client";

import { useState } from "react";
import { savePackagesAction } from "@/app/dashboard/settings/proposals/actions";
import { ActionForm, Outcome } from "./ActionForm";
import type { PricingValues } from "./PricingFields";

type PackageRow = PricingValues & { key: number };

/**
 * Settings → Client proposals → "Package prices": one card per package, with
 * the six fields the proposal editor uses, in dollars (whole cents are stored).
 * The first package is the default a new proposal starts from. "Add package"
 * starts from a copy of the last one's numbers, with a blank name that has to
 * be filled in; "Remove" is disabled on the last package, and the action refuses
 * it as well. Posted as `pkg.<n>.<field>`; the server action re-parses and
 * validates everything, and re-checks the admin gate.
 */
export function PackagePricesForm({ packages }: { packages: PricingValues[] }) {
  const [rows, setRows] = useState<PackageRow[]>(() => packages.map((p, key) => ({ ...p, key })));
  const [nextKey, setNextKey] = useState(packages.length);

  function add() {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [...prev, { ...(last ?? emptyPackage), package: "", key: nextKey }];
    });
    setNextKey((k) => k + 1);
  }

  function remove(key: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  }

  return (
    <ActionForm action={savePackagesAction} className="pe-pkgs">
      {({ state, pending }) => (
        <section className="lx-card pe-card" aria-labelledby="package-prices-h">
          <header className="pe-card-head">
            <h2 className="pe-h" id="package-prices-h">
              Package prices
            </h2>
            <p className="lx-note pe-hint">
              Dollars here, whole cents underneath. Totals are always worked out from these, never typed. USPTO fees are due at filing and are shown to the
              client separately.
            </p>
          </header>
          {rows.map((row, n) => (
            <fieldset key={row.key} className="pe-fieldset pe-pkg" aria-label={`Package ${n + 1}`}>
              <div className="pe-pkg-head">
                <span className="lx-label">{n === 0 ? "Package 1 · default for new proposals" : `Package ${n + 1}`}</span>
                <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => remove(row.key)} disabled={rows.length <= 1 || pending}>
                  Remove
                </button>
              </div>
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">Package name</span>
                  <input className="lx-input" name={`pkg.${n}.package`} required maxLength={120} defaultValue={row.package} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Price with the included classes ($)</span>
                  <input className="lx-input" name={`pkg.${n}.base`} inputMode="decimal" required defaultValue={row.base} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Classes included</span>
                  <input className="lx-input" name={`pkg.${n}.includedClasses`} inputMode="numeric" required defaultValue={row.includedClasses} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Per class over / under ($)</span>
                  <input className="lx-input" name={`pkg.${n}.perClass`} inputMode="decimal" required defaultValue={row.perClass} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Second mark discount (%)</span>
                  <input className="lx-input" name={`pkg.${n}.secondMarkPct`} inputMode="decimal" required defaultValue={row.secondMarkPct} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">USPTO fee per class per mark ($)</span>
                  <input className="lx-input" name={`pkg.${n}.govPerClass`} inputMode="decimal" required defaultValue={row.govPerClass} />
                </label>
              </div>
            </fieldset>
          ))}
          <div className="pe-save">
            <button type="button" className="lx-btn lx-btn-sec" onClick={add} disabled={pending}>
              Add package
            </button>
            <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
              {pending ? "Saving…" : "Save prices"}
            </button>
            <Outcome state={state} pending={pending} />
          </div>
        </section>
      )}
    </ActionForm>
  );
}

const emptyPackage: PricingValues = { package: "", base: "", includedClasses: "", perClass: "", secondMarkPct: "", govPerClass: "" };
