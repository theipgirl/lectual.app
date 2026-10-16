/**
 * AffiniPay / LawPay Hosted Fields — the constants the browser half needs, in
 * one place that is not a React component.
 *
 * ── WHY THESE VALUES ARE HERE AND NOT INLINE ────────────────────────────────
 * Every value below is part of a payment integration's wire contract with a
 * third party. Inline in a component they are three string literals nobody
 * reviews; here they are a list a test can assert against and a reader can
 * check against the vendor's documentation in one pass.
 *
 * ── PROVENANCE: VENDOR DOCUMENTATION, READ DIRECTLY, 2026-09-11 ─────────────
 * `developers.8am.com/collect/create-payment-form-hosted-fields.html` was read
 * directly; the contract it documents is recorded in
 * docs/research/2026-09-09-lawpay-cosmolex.md ("Hosted Fields — the client
 * half"). Specifically documented, not inferred:
 *
 *   - the script lives at
 *     `https://cdn.affinipay.com/hostedfields/<version>/fieldGen_<version>.js`
 *     and exposes `window.AffiniPay.HostedFields`;
 *   - `initializeFields(config, callback)` takes `{ publicKey, fields: [{
 *     selector, input: { type, css, placeholder } }] }`, where `selector` is a
 *     CSS selector for a container element WE choose and the library replaces
 *     with an iframe served from the vendor's own origin;
 *   - the callback receives `{ isReady, target, fields }`, and `isReady` is
 *     true when every hosted field has tokenised;
 *   - `getPaymentToken(formData)` returns a promise resolving to an object
 *     whose `id` is the single-use token that becomes `method` on
 *     `POST /v1/charges`.
 *
 * The container ids are ours, so nothing here is a guess about a name the
 * vendor chose. What is NOT documented — and is therefore treated as opaque
 * everywhere it is used — is the shape of the promise's REJECTION value and
 * whether any teardown method exists. See `PayPanel.tsx`.
 *
 * Ported unchanged from lectual (branch claude/lectual-firm-dashboard-prd-f3loev).
 * The public key it is initialised with is now the FIRM's own mapped operating
 * account's public_key (from that firm's LawPay connection), not an env var.
 *
 * ── NOT VERIFIED AGAINST A LIVE MERCHANT ACCOUNT ────────────────────────────
 * No card has ever been tokenised through this. See `lawpay.ts`'s header for
 * the full list of what a live test must confirm first.
 */

/**
 * PINNED, DELIBERATELY. A payment form is the last place to accept a silent
 * third-party upgrade: `fieldGen_latest.js` would mean a vendor push could
 * change what runs inside a page where somebody is typing a card number, with
 * no deploy and no review here. Moving this is a code change and a re-test.
 */
export const HOSTED_FIELDS_VERSION = "1.5.3";

export const HOSTED_FIELDS_SCRIPT_URL =
  `https://cdn.affinipay.com/hostedfields/${HOSTED_FIELDS_VERSION}/fieldGen_${HOSTED_FIELDS_VERSION}.js` as const;

/**
 * The ids of the empty containers the library replaces with its own iframes.
 *
 * Ours to choose, and chosen to be unmistakable in a DOM inspector: an element
 * called this is not something a future edit will repurpose for layout. They
 * are prefixed rather than generic (`#card-number` would collide with any other
 * form on a page that grows one) and they are CONSTANTS because the component
 * writes the same string into both the markup and the config — two literals
 * that must agree is a bug waiting for a rename.
 */
export const HOSTED_FIELD_IDS = {
  cardNumber: "lawpay-hosted-card-number",
  cvv: "lawpay-hosted-cvv",
} as const;

/** The vendor's `input.type` values for the two card fields we mount. */
export const HOSTED_FIELD_TYPES = {
  cardNumber: "credit_card_number",
  cvv: "cvv",
} as const;

/**
 * The window global the script defines. Typed as `unknown`-ish on purpose: the
 * component narrows it at runtime and refuses to proceed if the shape is not
 * what is documented, rather than trusting a `declare global` that would make
 * an absent library look present to the type checker.
 */
export type HostedFieldsGlobal = {
  HostedFields?: {
    initializeFields?: (
      config: unknown,
      callback: (state: { isReady?: boolean }) => void,
    ) => { getPaymentToken?: (formData: Record<string, string>) => Promise<{ id?: string }> };
  };
};
