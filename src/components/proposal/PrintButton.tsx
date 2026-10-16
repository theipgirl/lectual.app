"use client";

/**
 * "Download or print signed copy": opens the browser's print dialog over the
 * print stylesheet in `app/q/[token]/q.css` (Save as PDF is one of its
 * destinations). Labelled for what it does — nothing here generates a PDF.
 */
export function PrintButton() {
  return (
    <button type="button" className="qp-print" onClick={() => window.print()}>
      Download or print signed copy
    </button>
  );
}
