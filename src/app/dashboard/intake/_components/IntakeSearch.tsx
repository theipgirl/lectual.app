"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The Search box in the page header, in the same place and the same markup as
 * Matters' (`lx-search-form` + `lx-input`).
 *
 * The text is local so typing stays instant; the workspace applies the filter
 * and debounces the URL rewrite. It is re-synced when the filter changes from
 * somewhere else (a cleared view, a back button). Submitting does nothing: the
 * list already narrows as you type, and a form post would reload the page.
 */
export default function IntakeSearch({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [query, setQuery] = useState(value);
  const lastPushed = useRef(value);
  useEffect(() => {
    if (value !== lastPushed.current) {
      lastPushed.current = value;
      setQuery(value);
    }
  }, [value]);

  function commit(next: string) {
    setQuery(next);
    lastPushed.current = next;
    onChange(next);
  }

  return (
    <form className="lx-search-form" role="search" onSubmit={(event) => event.preventDefault()}>
      <input
        className="lx-input"
        type="search"
        value={query}
        placeholder="Name, mark, or note"
        aria-label="Search leads"
        onChange={(event) => commit(event.target.value)}
      />
    </form>
  );
}
