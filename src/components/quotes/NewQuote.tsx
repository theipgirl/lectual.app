"use client";

import { useEffect, useState } from "react";
import { NewQuoteForm, type ClientPickerOptions } from "./QuoteForms";

/** The header's "New quote" button and the panel under it talk through this window event, so the button can sit in the page header. */
export const NEW_QUOTE_EVENT = "lectual:new-quote";

/** The "New quote" button for the page header: it opens the form below (and closes it again). */
export function NewQuoteButton() {
  return (
    <button type="button" className="lx-btn lx-btn-pri" onClick={() => window.dispatchEvent(new Event(NEW_QUOTE_EVENT))}>
      New quote
    </button>
  );
}

/** The existing New quote form, shown when the header button is pressed. */
export function NewQuotePanel({ options }: { options: ClientPickerOptions }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setOpen((v) => !v);
    window.addEventListener(NEW_QUOTE_EVENT, toggle);
    return () => window.removeEventListener(NEW_QUOTE_EVENT, toggle);
  }, []);
  if (!open) return null;
  return (
    <section className="lx-card lx-pad" id="new-quote" aria-label="New quote">
      <NewQuoteForm options={options} />
    </section>
  );
}
