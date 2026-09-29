"use client";

import { useState, type CSSProperties } from "react";
import { CONTACT_FIELDS, displayIntro, DEFAULT_CLOSING, DEFAULT_OPENING, type IntakeFormConfig, type IntakeMode } from "@/lib/intake-forms/config";

/**
 * The editor's live preview (design: "Live preview"). Drawn from the UNSAVED
 * config, so every keystroke shows. It is a picture of the public page, not
 * the public page: nothing typed here is sent anywhere.
 *
 * The conversation is scripted, as the MVP's public side is: the opening,
 * the contact question, then each configured question in order, then the
 * closing message. There is no free-form AI reply to a prospect.
 */

type Pkg = { name: string; price: string; includes: string };

export function IntakePreview(props: {
  config: IntakeFormConfig;
  orgName: string;
  packages: Pkg[];
  theme: "light" | "dark";
  onTheme: (t: "light" | "dark") => void;
}) {
  const { config } = props;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [modeOverride, setModeOverride] = useState<IntakeMode | null>(null);
  const [msgs, setMsgs] = useState<{ who: "you" | "bot"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  // Picking a mode in the editor shows that mode, even after "Switch to form".
  const [seenMode, setSeenMode] = useState(config.mode);
  if (seenMode !== config.mode) {
    setSeenMode(config.mode);
    setModeOverride(null);
  }

  const mode = modeOverride ?? config.mode;
  const dark = props.theme === "dark";
  const intro = displayIntro(config, props.orgName);
  const questions = config.questions.filter((q) => q.text.trim());
  const showPkgs = config.feesOn && props.packages.length > 0;

  const vars = {
    "--pv-bg": dark ? config.colors.darkBg : config.colors.lightBg,
    "--pv-acc": dark ? config.colors.darkAcc : config.colors.lightAcc,
    "--pv-ink": dark ? "#F6EDE4" : "#2A1216",
    "--pv-mute": dark ? "rgba(246,237,228,.66)" : "#7A5A5E",
    "--pv-line": dark ? "rgba(246,237,228,.14)" : "rgba(42,18,22,.12)",
    "--pv-field": dark ? "rgba(246,237,228,.06)" : "#FFFFFF",
    "--pv-bot": dark ? "rgba(246,237,228,.08)" : "#F1E8D8",
    "--pv-on-acc": dark ? "#1E0A0E" : "#FFFFFF",
  } as CSSProperties;

  const send = () => {
    const v = draft.trim();
    if (!v) return;
    const answered = msgs.filter((m) => m.who === "you").length;
    const next = questions[answered] ? questions[answered].text : config.closing.trim() || DEFAULT_CLOSING;
    setMsgs([...msgs, { who: "you", text: v }, { who: "bot", text: next }]);
    setDraft("");
  };
  const restart = () => {
    setMsgs([]);
    setDraft("");
    setModeOverride(null);
  };

  const thread = [
    { who: "bot" as const, text: config.opening.trim() || DEFAULT_OPENING },
    { who: "bot" as const, text: "First, what's your full name, email, phone and company?" },
    ...msgs,
  ];

  const pkgList = showPkgs && (
    <div className="ifm-pv-pkgs">
      {props.packages.map((p, i) => (
        <div key={i} className="ifm-pv-card">
          <div className="ifm-pv-pkg-head">
            <span className="ifm-pv-pkg-name">{p.name}</span>
            <span className="ifm-pv-pkg-price">{p.price}</span>
          </div>
          {p.includes && <div className="ifm-pv-small">{p.includes}</div>}
        </div>
      ))}
    </div>
  );

  return (
    <section className="ifm-preview" aria-label="Live preview">
      <div className="ifm-pv-bar">
        <div className="ifm-pv-title">Live preview</div>
        <div className="ifm-seg" role="group" aria-label="Device">
          {(["desktop", "mobile"] as const).map((d) => (
            <button key={d} type="button" className={device === d ? "on" : ""} aria-pressed={device === d} onClick={() => setDevice(d)}>
              {d === "desktop" ? "Desktop" : "Mobile"}
            </button>
          ))}
        </div>
        <div className="ifm-seg" role="group" aria-label="Preview theme">
          {(["light", "dark"] as const).map((t) => (
            <button key={t} type="button" className={props.theme === t ? "on" : ""} aria-pressed={props.theme === t} onClick={() => props.onTheme(t)}>
              {t === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
        <button type="button" className="ifm-pv-restart" onClick={restart}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
          </svg>
          Restart
        </button>
      </div>

      <div className="ifm-pv-stage">
        <div className={`ifm-pv-frame${device === "mobile" ? " mobile" : ""}`} style={vars}>
          <div className="ifm-pv-head">
            <div className="ifm-pv-firm">{intro.firmName}</div>
            <div className="ifm-pv-headline">{intro.headline}</div>
          </div>

          {mode === "conversation" ? (
            <>
              <div className="ifm-pv-thread">
                {thread.map((m, i) => (
                  <div key={i} className={`ifm-pv-bubble ${m.who}`}>
                    {m.text}
                  </div>
                ))}
                {pkgList}
              </div>
              <div className="ifm-pv-composer-wrap">
                <div className="ifm-pv-composer">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        send();
                      }
                    }}
                    placeholder="Type your answer…"
                    aria-label="Preview composer"
                  />
                  <button type="button" className="ifm-pv-send" onClick={send} aria-label="Send">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
                <div className="ifm-pv-foot">
                  <button type="button" className="ifm-pv-link" onClick={() => setModeOverride("form")}>
                    Switch to form
                  </button>
                  <span style={{ flex: 1 }} />
                  {config.powered && <span className="ifm-pv-powered">Powered by Lectual</span>}
                </div>
              </div>
            </>
          ) : (
            <div className="ifm-pv-form">
              {[
                ...CONTACT_FIELDS.map((f) => ({ label: f.label, required: f.required })),
                ...questions.map((q) => ({ label: q.text, required: q.required })),
              ].map((f, i) => (
                <div key={i} className="ifm-pv-field">
                  <div className="ifm-pv-label">
                    {f.label}
                    {f.required && <span className="ifm-pv-req"> *</span>}
                  </div>
                  <div className="ifm-pv-box" />
                </div>
              ))}
              {showPkgs && (
                <div className="ifm-pv-field">
                  <div className="ifm-pv-label">Flat-fee packages</div>
                  {pkgList}
                </div>
              )}
              <div className="ifm-pv-small">{intro.disclaimer}</div>
              <div className="ifm-pv-consent">
                <span className="ifm-pv-check" />
                <span>{intro.consent}</span>
              </div>
              <div className="ifm-pv-submit">Submit</div>
              <div className="ifm-pv-foot">
                <button type="button" className="ifm-pv-link" onClick={() => setModeOverride("conversation")}>
                  Chat instead
                </button>
                <span style={{ flex: 1 }} />
                {config.powered && <span className="ifm-pv-powered">Powered by Lectual</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
