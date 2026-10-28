"use client";

import { useRef, useState, type KeyboardEvent, type ReactNode } from "react";

const TABS = [
  { id: "text", label: "Text" },
  { id: "voice", label: "Voice" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/**
 * The lead's notes composer: Text and Voice as two tabs. Both panels stay mounted (a recording in
 * progress survives a look at the other tab); only the active one is shown. Left / Right / Home /
 * End move between the tabs, as a tablist does.
 */
export function ComposerTabs({ text, voice }: { text: ReactNode; voice: ReactNode }) {
  const [active, setActive] = useState<TabId>("text");
  const refs = useRef<Record<TabId, HTMLButtonElement | null>>({ text: null, voice: null });

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    const i = TABS.findIndex((t) => t.id === active);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setActive(TABS[next].id);
    refs.current[TABS[next].id]?.focus();
  }

  return (
    <div className="lx-composer" style={{ display: "grid", gap: 10 }}>
      <div role="tablist" aria-label="Add to the timeline" className="lx-segs">
        {TABS.map((t) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`composer-tab-${t.id}`}
            aria-selected={active === t.id}
            aria-controls={`composer-panel-${t.id}`}
            tabIndex={active === t.id ? 0 : -1}
            className={active === t.id ? "on" : undefined}
            onClick={() => setActive(t.id)}
            onKeyDown={onKeyDown}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="composer-panel-text" aria-labelledby="composer-tab-text" hidden={active !== "text"}>
        {text}
      </div>
      <div role="tabpanel" id="composer-panel-voice" aria-labelledby="composer-tab-voice" hidden={active !== "voice"}>
        {voice}
      </div>
    </div>
  );
}
