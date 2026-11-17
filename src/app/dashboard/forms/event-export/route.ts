import { exportEventCsv } from "@/lib/intake-forms/event-export-csv";

/** One booth event's CSV. All of the rules are in `exportEventCsv`. */
export async function GET(request: Request) {
  return exportEventCsv(request);
}
