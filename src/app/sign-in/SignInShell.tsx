import { SIGN_IN_TRUST_CHIPS } from "@/lib/ui/words";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import SkyPanel from "./SkyPanel";
import "./sign-in.css";

/** One small line icon per trust chip, in the chips' order. Decorative: the chip's text says it. */
const CHIP_ICONS = [
  // a closed room: one firm, its own walls
  <svg key="tenant" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M8 1.75 13.25 4v4.1c0 3.05-2.2 5.3-5.25 6.15C4.95 13.4 2.75 11.15 2.75 8.1V4L8 1.75Z" />
  </svg>,
  // a check: a person says yes
  <svg key="gate" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="6.25" />
    <path d="m5.4 8.2 1.8 1.8 3.4-3.6" />
  </svg>,
  // a tag: one price
  <svg key="fee" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 2.75h5.2L14 9.55 9.55 14 2.75 7.2V2.75Z" />
    <circle cx="5.4" cy="5.4" r="1" />
  </svg>,
];

/**
 * The sign-in screens' frame (sign-in and the confirm step): the wordmark, a narrow centred column holding the page's own
 * content, the three trust chips and the not-a-law-firm line, and the decorative sky panel. On a phone the column comes
 * first and the panel follows it. Keyboard order is the column's, since the panel holds nothing focusable.
 */
export default function SignInShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="lx-si">
      <div className="lx-si-side">
        <div className="lx-si-top">
          {/* "/" in this app sends a signed-out visitor straight back here, so the wordmark is not a link. */}
          <span className="lx-si-mark">Lectual</span>
        </div>
        <div className="lx-si-col">
          <div className="lx-si-orb" aria-hidden="true" />
          {children}
          <ul className="lx-si-chips">
            {SIGN_IN_TRUST_CHIPS.map((chip, i) => (
              <li key={chip} className="lx-si-chip">
                {CHIP_ICONS[i]}
                {chip}
              </li>
            ))}
          </ul>
          <p className="lx-si-legal">{NOT_A_LAW_FIRM_DISCLAIMER}</p>
        </div>
      </div>
      <SkyPanel />
    </main>
  );
}
