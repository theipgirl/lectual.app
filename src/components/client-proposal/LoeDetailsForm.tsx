import { DETAILS_HEADING, DETAILS_INTRO, detailsSavedNote } from "@/lib/loe/client-words";
import { MAX_CLIENT_TEXT_CHARS } from "@/lib/proposals/client-classes";
import { US_STATES, isUnitedStates, stateOptionLabel, usStateCode } from "@/lib/loe/us-states";
import { REQUIRED_DETAIL_KEYS, type SignerDetails } from "@/lib/loe/signing";

/**
 * Step 2: the details that go on the letter. Plain controlled inputs (React text, never HTML); the server cleans and checks
 * every one again. On the live page one line under the fields says Continue saves the address to the firm's file. Required: full legal name, street, city, state, ZIP or postal code and country (`REQUIRED_DETAIL_KEYS`, the same list
 * the server checks); the other three say "(optional)" in their label.
 */

type Field = { key: keyof SignerDetails; label: string; autoComplete: string };

const PERSON_FIELDS: Field[] = [
  { key: "client_name", label: "Full legal name", autoComplete: "name" },
  { key: "entity_name", label: "Business name (optional)", autoComplete: "organization" },
  { key: "title", label: "Your title in the business (optional)", autoComplete: "organization-title" },
];

function isRequired(key: keyof SignerDetails): boolean {
  return (REQUIRED_DETAIL_KEYS as readonly string[]).includes(key);
}

function Star({ required }: { required: boolean }) {
  return required ? <b aria-hidden="true"> *</b> : null;
}

export function LoeDetailsForm({
  details,
  onChange,
  readOnly,
  savedWith,
}: {
  details: SignerDetails;
  onChange: (key: keyof SignerDetails, value: string) => void;
  readOnly?: boolean;
  /** The firm's name, on the live page only (where Continue saves the address to the firm's records): draws `detailsSavedNote`. */
  savedWith?: string | null;
}) {
  const us = isUnitedStates(details.country);
  // A stored state that is a code or a full name selects that code; anything else stays visible so it is never silently dropped.
  const code = usStateCode(details.region);
  const stateValue = code ?? details.region;
  const extraState = !code && details.region ? details.region : null;
  return (
    <section className="cp-choose cp-details" aria-labelledby="cp-details-h">
      <div className="cp-step-h">
        <span className="cp-n" aria-hidden="true">
          2
        </span>
        <div>
          <h2 id="cp-details-h">{DETAILS_HEADING}</h2>
          <p>{DETAILS_INTRO}</p>
        </div>
      </div>
      <div className="cp-form">
        {PERSON_FIELDS.map((f) => {
          const required = isRequired(f.key);
          return (
            <label key={f.key} className={`cp-field${f.key === "title" ? "" : " cp-field-wide"}`}>
              <span>
                {f.label}
                <Star required={required} />
              </span>
              <input
                type="text"
                name={f.autoComplete}
                value={details[f.key]}
                required={required}
                aria-required={required ? true : undefined}
                maxLength={MAX_CLIENT_TEXT_CHARS}
                autoComplete={f.autoComplete}
                readOnly={readOnly}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            </label>
          );
        })}
      </div>
      <fieldset className="cp-address">
        <legend>Address</legend>
        <div className="cp-addr-grid">
          <label className="cp-field cp-addr-street">
            <span>
              Street address
              <Star required />
            </span>
            <input
              type="text"
              name="address-line1"
              value={details.street}
              required
              aria-required={true}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="address-line1"
              readOnly={readOnly}
              onChange={(e) => onChange("street", e.target.value)}
            />
          </label>
          <label className="cp-field cp-addr-street2">
            <span>Apartment, suite or unit (optional)</span>
            <input
              type="text"
              name="address-line2"
              value={details.street2}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="address-line2"
              readOnly={readOnly}
              onChange={(e) => onChange("street2", e.target.value)}
            />
          </label>
          <label className="cp-field cp-addr-city">
            <span>
              City
              <Star required />
            </span>
            <input
              type="text"
              name="address-level2"
              value={details.city}
              required
              aria-required={true}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="address-level2"
              readOnly={readOnly}
              onChange={(e) => onChange("city", e.target.value)}
            />
          </label>
          <label className="cp-field cp-addr-state">
            <span>
              {us ? "State" : "State, province or region"}
              <Star required />
            </span>
            {us ? (
              <select
                name="address-level1"
                value={stateValue}
                required
                aria-required={true}
                autoComplete="address-level1"
                disabled={readOnly}
                onChange={(e) => onChange("region", e.target.value)}
              >
                <option value="">Select a state</option>
                {extraState ? <option value={extraState}>{extraState}</option> : null}
                {US_STATES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {stateOptionLabel(s)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                name="address-level1"
                value={details.region}
                required
                aria-required={true}
                maxLength={MAX_CLIENT_TEXT_CHARS}
                autoComplete="address-level1"
                readOnly={readOnly}
                onChange={(e) => onChange("region", e.target.value)}
              />
            )}
          </label>
          <label className="cp-field cp-addr-postal">
            <span>
              ZIP or postal code
              <Star required />
            </span>
            <input
              type="text"
              name="postal-code"
              value={details.postal}
              required
              aria-required={true}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="postal-code"
              inputMode={us ? "numeric" : undefined}
              readOnly={readOnly}
              onChange={(e) => onChange("postal", e.target.value)}
            />
          </label>
          <label className="cp-field cp-addr-country">
            <span>
              Country
              <Star required />
            </span>
            <input
              type="text"
              name="country-name"
              value={details.country}
              required
              aria-required={true}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="country-name"
              readOnly={readOnly}
              onChange={(e) => onChange("country", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      {savedWith ? <p className="cp-details-note">{detailsSavedNote(savedWith)}</p> : null}
    </section>
  );
}
