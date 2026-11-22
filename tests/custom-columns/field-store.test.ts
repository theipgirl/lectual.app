import { describe, expect, it } from "vitest";
import { fieldStore, valueStore, type StoreClient } from "@/lib/custom-columns/store";

/**
 * F7 / C1 / C2: the store's calls on a recording fake client. Each update is `update(patch).eq("id", id).eq(<guard>, <value>).select("id")`,
 * each write is one object, and each select names its columns.
 */
type Step = [string, ...unknown[]];
function recorder(answer: { data: unknown; error: unknown }) {
  const chains: Step[][] = [];
  const client = {
    from(table: string) {
      const chain: Step[] = [["from", table]];
      chains.push(chain);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "is", "in", "order", "range", "limit"])
        q[m] = (...args: unknown[]) => {
          chain.push([m, ...args]);
          return q;
        };
      q.maybeSingle = () => {
        chain.push(["maybeSingle"]);
        return Promise.resolve(answer);
      };
      q.then = (resolve: (a: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject);
      return q;
    },
  };
  return { client: client as unknown as StoreClient, chains };
}

const ID = "00000000-0000-4000-8000-00000000f001";

describe("fieldStore", () => {
  it("updateField: update(patch).eq(id).eq(guard).select(id), one object; returns the row count", async () => {
    for (const [patch, guards] of [
      [{ label: "Urgency" }, { updated_at: "2026-11-20T10:00:00+00:00" }],
      [{ archived: true }, { archived: false }],
      [{ position: 3 }, { position: 4 }],
    ] as const) {
      const r = recorder({ data: [{ id: ID }], error: null });
      expect(await fieldStore(r.client).updateField(ID, patch, guards)).toBe(1);
      const [k, v] = Object.entries(guards)[0];
      expect(r.chains).toEqual([[["from", "crm_custom_field"], ["update", patch], ["eq", "id", ID], ["eq", k, v], ["select", "id"]]]);
      expect(Array.isArray(r.chains[0][1][1])).toBe(false);
    }
    const none = recorder({ data: [], error: null });
    expect(await fieldStore(none.client).updateField(ID, { label: "x" }, { updated_at: "s" })).toBe(0);
  });
  it("an error is thrown as it came (the logic maps it)", async () => {
    const r = recorder({ data: null, error: { code: "42P01", message: "x" } });
    await expect(fieldStore(r.client).updateField(ID, { label: "x" }, { updated_at: "s" })).rejects.toEqual({ code: "42P01", message: "x" });
    await expect(fieldStore(r.client).readField(ID)).rejects.toEqual({ code: "42P01", message: "x" });
  });
  it("readField and readLiveFields name their columns; the live list is ordered position, label, id; a read at the limit fails", async () => {
    const r = recorder({ data: [], error: null });
    await fieldStore(r.client).readField(ID);
    await fieldStore(r.client).readLiveFields();
    expect(r.chains[0]).toEqual([["from", "crm_custom_field"], ["select", "id, section, kind, label, options, position, archived, updated_at"], ["eq", "id", ID], ["maybeSingle"]]);
    expect(r.chains[1]).toEqual([["from", "crm_custom_field"], ["select", "id, section, label, kind, options, position"], ["eq", "archived", false], ["order", "position"], ["order", "label"], ["order", "id"], ["limit", 1000]]);
    const full = recorder({ data: Array.from({ length: 1000 }, () => ({})), error: null });
    await expect(fieldStore(full.client).readLiveFields()).rejects.toBeInstanceOf(Error);
  });
  it("insertField: one object, then select(id)", async () => {
    const r = recorder({ data: [{ id: ID }], error: null });
    const row = { org_id: "o", section: "trademarks" as const, label: "Priority", kind: "text" as const, options: [], position: 0 };
    await fieldStore(r.client).insertField(row);
    expect(r.chains[0]).toEqual([["from", "crm_custom_field"], ["insert", row], ["select", "id"]]);
  });
  it("readOptionUse counts per option, paged on id", async () => {
    const r = recorder({ data: [{ id: "a", value_choice: "High" }, { id: "b", value_choice: "High" }, { id: "c", value_choice: "Low" }], error: null });
    expect(await fieldStore(r.client).readOptionUse(ID, ["High", "Low", "Medium"])).toEqual({ High: 2, Low: 1, Medium: 0 });
    expect(r.chains[0]).toEqual([["from", "crm_custom_value"], ["select", "id, value_choice"], ["eq", "field_id", ID], ["in", "value_choice", ["High", "Low", "Medium"]], ["order", "id"], ["range", 0, 999]]);
  });
});

describe("valueStore", () => {
  it("reads the record by kind (SELECT only) and the value row by field and record", async () => {
    const r = recorder({ data: null, error: null });
    await valueStore(r.client).readRecord("lead", ID);
    await valueStore(r.client).readRecord("matter", ID);
    await valueStore(r.client).readValueRow(ID, "lead", "L");
    await valueStore(r.client).readValueRow(ID, "matter", "M");
    expect(r.chains).toEqual([
      [["from", "crm_lead"], ["select", "id, org_id"], ["eq", "id", ID], ["maybeSingle"]],
      [["from", "crm_matter"], ["select", "id, org_id, type"], ["eq", "id", ID], ["maybeSingle"]],
      [["from", "crm_custom_value"], ["select", "id"], ["eq", "field_id", ID], ["eq", "lead_id", "L"], ["is", "matter_id", null], ["maybeSingle"]],
      [["from", "crm_custom_value"], ["select", "id"], ["eq", "field_id", ID], ["eq", "matter_id", "M"], ["is", "lead_id", null], ["maybeSingle"]],
    ]);
  });
  it("update and delete are by id with select(id); insert is one object", async () => {
    const r = recorder({ data: [{ id: "v" }], error: null });
    expect(await valueStore(r.client).updateValue("v", { value_choice: "High" })).toBe(1);
    expect(await valueStore(r.client).deleteValue("v")).toBe(1);
    await valueStore(r.client).insertValue({ org_id: "o", field_id: ID, lead_id: "L", value_choice: "High" });
    expect(r.chains).toEqual([
      [["from", "crm_custom_value"], ["update", { value_choice: "High" }], ["eq", "id", "v"], ["select", "id"]],
      [["from", "crm_custom_value"], ["delete"], ["eq", "id", "v"], ["select", "id"]],
      [["from", "crm_custom_value"], ["insert", { org_id: "o", field_id: ID, lead_id: "L", value_choice: "High" }]],
    ]);
  });
});
