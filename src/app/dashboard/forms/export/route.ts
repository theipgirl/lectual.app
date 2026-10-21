import { exportIntakeCsv } from "@/lib/intake-forms/export-csv";

/** The Results tab's "Export CSV". All of the rules are in `exportIntakeCsv`. */
export async function GET(request: Request) {
  return exportIntakeCsv(request);
}
