import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { adobeClientSigningOn, adobeSignSetup } from "./adobe-config";
import { countWaitingClients, getAdobeConnection } from "./adobe-connection";
import type { EsignDb } from "./db";
import { adobeRowView, type AdobeRowView } from "./settings-view";

/**
 * The Integrations row's reads, in one place (scoped client only): the firm's connection (three states), and only for `reauth`
 * the number of clients waiting. Never throws: anything unexpected is "couldn't check".
 */
export async function loadAdobeRow(canManage: boolean): Promise<AdobeRowView> {
  try {
    const read = await getAdobeConnection();
    const waiting = read.state === "ok" && read.connection?.status === "reauth" ? await countWaitingClients((await getScopedClient()) as unknown as EsignDb) : null;
    return adobeRowView({ setupReady: adobeSignSetup().ready, switchOn: adobeClientSigningOn(), read, waiting, canManage });
  } catch {
    return adobeRowView({ setupReady: true, switchOn: false, read: { state: "unavailable" }, waiting: null, canManage });
  }
}
