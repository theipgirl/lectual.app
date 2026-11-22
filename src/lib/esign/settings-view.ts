import type { IntegrationState } from "@/components/integrations/states";
import {
  ADOBE_COULDNT_CHECK,
  ADOBE_NOT_CONNECTED_HELP,
  ADOBE_NOT_SET_UP,
  ADOBE_REAUTH_HELP,
  ADOBE_SWITCH_OFF_LINE,
  adobeConnectedAs,
  adobeWaitingLine,
} from "@/lib/ui/words";
import type { AdobeConnectionRead } from "./adobe-connection";

/**
 * The Settings → Integrations "Adobe Acrobat Sign" row (Sprint 5a, contract item 4). PURE. Three states (connected / not
 * connected / couldn't check) plus `reauth` → Reconnect; and "not set up" when Lectual hasn't switched Adobe on for this
 * deployment (its connect button is disabled with SWITCH_ON_WORDS). Optional: not a setup-checklist item.
 */
export type AdobeRowView = {
  state: IntegrationState;
  help: string;
  /** The connect / reconnect link, or a disabled button when the deployment isn't set up. */
  connect: "connect" | "reconnect" | "disabled" | null;
  disconnect: boolean;
};

export function adobeRowView(input: { setupReady: boolean; switchOn: boolean; read: AdobeConnectionRead; waiting: number | null; canManage: boolean }): AdobeRowView {
  const manage = input.canManage;
  if (input.read.state === "unavailable") return { state: "couldnt-check", help: ADOBE_COULDNT_CHECK, connect: null, disconnect: false };
  const conn = input.read.state === "ok" ? input.read.connection : null;
  if (!input.setupReady || input.read.state === "not-set-up") {
    // A connection may still exist (the env was removed after connecting): it can still be disconnected.
    return { state: "not-available", help: ADOBE_NOT_SET_UP, connect: manage ? "disabled" : null, disconnect: manage && conn !== null && conn.status !== "revoked" };
  }
  if (!conn || conn.status === "revoked") return { state: "not-connected", help: ADOBE_NOT_CONNECTED_HELP, connect: manage ? "connect" : null, disconnect: false };
  if (conn.status === "reauth") {
    const waiting = input.waiting !== null && input.waiting > 0 ? ` ${adobeWaitingLine(input.waiting)}` : "";
    return { state: "reconnect", help: `${ADOBE_REAUTH_HELP}${waiting}`, connect: manage ? "reconnect" : null, disconnect: manage };
  }
  const help = `${adobeConnectedAs(conn.account_email)}${input.switchOn ? "" : ` ${ADOBE_SWITCH_OFF_LINE}`}`;
  return { state: "connected", help, connect: null, disconnect: manage };
}
