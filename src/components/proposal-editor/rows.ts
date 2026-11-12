"use client";

import { useRef, useState } from "react";
import { useUnsaved } from "./UnsavedGuard";

export type Keyed<T> = T & { key: string };

/**
 * Client-side list state for the repeated rows of a form (marks, classes,
 * adjustments, included items). Rows are uncontrolled inputs keyed by a stable
 * `key`, so adding, removing or moving a row never disturbs what has been typed
 * into the others. Nothing is saved until the form is submitted.
 */
export function useRows<T extends object>(initial: readonly T[]) {
  const counter = useRef(initial.length);
  const [rows, setRows] = useState<Keyed<T>[]>(() => initial.map((r, i) => ({ ...r, key: `k${i}` })));
  // Adding or removing a row fires no input event, so it marks the page unsaved itself.
  const { rowAdded, rowRemoved, markDirty } = useUnsaved();

  return {
    rows,
    add(row: T) {
      const key = `k${counter.current++}`;
      setRows((rs) => [...rs, { ...row, key }]);
      rowAdded();
    },
    remove(key: string) {
      setRows((rs) => rs.filter((r) => r.key !== key));
      rowRemoved();
    },
    move(key: string, by: -1 | 1) {
      markDirty();
      setRows((rs) => {
        const i = rs.findIndex((r) => r.key === key);
        const j = i + by;
        if (i < 0 || j < 0 || j >= rs.length) return rs;
        const next = [...rs];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      });
    },
  };
}

/** A short random id for a new mark / class / adjustment. Called from event handlers only. */
export function newRowId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}
