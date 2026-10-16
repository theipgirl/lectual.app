import { describe, expect, it } from "vitest";

import { leadPickerLabel } from "@/lib/quotes/client-labels";

describe("leadPickerLabel", () => {
  it("names the person, then the business, then the email", () => {
    expect(
      leadPickerLabel({ first_name: "Jordan", last_name: "Rivera", business_name: "Rivera Roasters LLC", email: "jordan@example.com" }),
    ).toBe("Jordan Rivera · Rivera Roasters LLC · jordan@example.com");
  });

  it("leaves out what is missing, and does not repeat a business named like the person", () => {
    expect(leadPickerLabel({ first_name: "Jordan", last_name: "", business_name: null, email: "j@example.com" })).toBe("Jordan · j@example.com");
    expect(leadPickerLabel({ first_name: "", last_name: "", business_name: "Acme", email: null })).toBe("Acme");
    expect(leadPickerLabel({ first_name: "Ann", last_name: "Lee", business_name: "Ann Lee", email: null })).toBe("Ann Lee");
    expect(leadPickerLabel({ first_name: null, last_name: null, business_name: null, email: null })).toBe("Unnamed lead");
  });
});
