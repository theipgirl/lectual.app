import { describe, expect, it } from "vitest";
import { ownerConsultJoinLink } from "@/lib/ui/words";

describe("owner Today consult join link words", () => {
  it("names the meeting service as the Today board does", () => {
    expect(ownerConsultJoinLink("https://zoom.us/j/111")).toBe("Zoom link");
    expect(ownerConsultJoinLink("https://us02web.zoom.us/j/222")).toBe("Zoom link");
    expect(ownerConsultJoinLink("https://teams.microsoft.com/l/meetup-join/x")).toBe("Teams link");
  });
  it("falls back to a neutral label for any other or unreadable link", () => {
    expect(ownerConsultJoinLink("https://notzoom.us.example/j/1")).toBe("Join link");
    expect(ownerConsultJoinLink("not a url")).toBe("Join link");
  });
});
