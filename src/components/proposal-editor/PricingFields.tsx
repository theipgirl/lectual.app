"use client";

export type PricingValues = {
  package: string;
  base: string;
  includedClasses: string;
  perClass: string;
  secondMarkPct: string;
  govPerClass: string;
};

/** The six package fields. Shared by the proposal editor and the firm's settings page. */
export function PricingFields({ values }: { values: PricingValues }) {
  return (
    <div className="lx-form-grid">
      <label className="lx-field">
        <span className="lx-label">Package name</span>
        <input className="lx-input" name="package" required maxLength={120} defaultValue={values.package} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Price with the included classes ($)</span>
        <input className="lx-input" name="base" inputMode="decimal" required defaultValue={values.base} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Classes included</span>
        <input className="lx-input" name="includedClasses" inputMode="numeric" required defaultValue={values.includedClasses} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Per class over / under ($)</span>
        <input className="lx-input" name="perClass" inputMode="decimal" required defaultValue={values.perClass} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Second mark discount (%)</span>
        <input className="lx-input" name="secondMarkPct" inputMode="decimal" required defaultValue={values.secondMarkPct} />
      </label>
      <label className="lx-field">
        <span className="lx-label">USPTO fee per class per mark ($)</span>
        <input className="lx-input" name="govPerClass" inputMode="decimal" required defaultValue={values.govPerClass} />
      </label>
    </div>
  );
}

