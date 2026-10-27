import { describe, expect, it } from "vitest";
import { addedClassesPhrase, clientAddedClasses } from "@/lib/proposals/added-view";
import { acceptedSnapshot } from "./accepted-fixture";

describe("clientAddedClasses / addedClassesPhrase", () => {
  it("returns only selected client_added classes, with the brand and the client's description", () => {
    const snap = acceptedSnapshot({ classes: 1 });
    const nm = snap.content.names[0];
    nm.classes.push({ id: "a1", label: "Podcast production", preselected: false, client_added: true });
    nm.classes.push({ id: "a2", label: "Unticked extra", preselected: false, client_added: true });
    snap.selection["a1"] = true;
    snap.selection["a2"] = false;
    expect(clientAddedClasses(snap)).toEqual([{ brand: nm.name, description: "Podcast production" }]);
  });

  it("excludes a client_added class that is not in the selection at all, and ordinary classes", () => {
    const snap = acceptedSnapshot({ classes: 3 });
    snap.content.names[0].classes.push({ id: "a3", label: "Never ticked", preselected: false, client_added: true });
    expect(clientAddedClasses(snap)).toEqual([]);
  });

  it("a null or missing snapshot gives []", () => {
    expect(clientAddedClasses(null)).toEqual([]);
    expect(clientAddedClasses(undefined)).toEqual([]);
  });

  it("phrases the count", () => {
    expect(addedClassesPhrase([])).toBe("");
    expect(addedClassesPhrase([{ brand: "A", description: "x" }])).toBe("adding 1 class");
    expect(addedClassesPhrase([{ brand: "A", description: "x" }, { brand: "A", description: "y" }])).toBe("adding 2 classes");
  });
});
