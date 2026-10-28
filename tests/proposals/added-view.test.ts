import { describe, expect, it } from "vitest";
import { addedClassesPhrase, clientAddedClasses, clientDescribedClasses } from "@/lib/proposals/added-view";
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

describe("clientDescribedClasses (Spec 3)", () => {
  it("returns ticked open classes with the firm's question and the client's words; never unticked, empty or added ones", () => {
    const snap = acceptedSnapshot({ classes: 1 });
    const nm = snap.content.names[0];
    nm.classes.push({ id: "o1", label: "Scented candles", prompt: "What do you sell?", preselected: true, client_entry: true });
    nm.classes.push({ id: "o2", label: "Not ticked", prompt: "What do you sell?", preselected: false, client_entry: true });
    nm.classes.push({ id: "o3", label: "", prompt: "What do you sell?", preselected: false, client_entry: true });
    nm.classes.push({ id: "a1", label: "Added one", preselected: true, client_added: true });
    Object.assign(snap.selection, { o1: true, o2: false, o3: true, a1: true });
    expect(clientDescribedClasses(snap)).toEqual([{ brand: nm.name, prompt: "What do you sell?", description: "Scented candles" }]);
    expect(clientDescribedClasses(null)).toEqual([]);
  });
});
