/** Fixture responses in the ASSUMED legacy info.json shape (UNVERIFIED, see src/lib/uspto/README.md). Made-up data. */
export function tsdr(over: Record<string, unknown> = {}, serial = "88123456") {
  return {
    trademarks: [
      {
        status: {
          serialNumber: serial,
          status: 700,
          statusDescription: "Registered",
          statusDate: "2023-05-02",
          filingDate: "2021-03-10",
          usRegistrationDate: "2023-05-02",
          markElement: "SECRET BRAND",
          ownerName: "Jane Q. Client",
          ownerAddress: "12 Private Lane, Miami FL",
          attorneyName: "Some Attorney",
          ...over,
        },
        parties: { owner: { name: "Jane Q. Client", email: "jane@example.com" } },
      },
    ],
  };
}
export const registered = tsdr();
export const pending = tsdr({ status: 630, statusDescription: "New application - record initialized, not assigned to examiner", usRegistrationDate: undefined, statusDate: "2024-01-05" });
export const officeAction = tsdr({ status: 641, statusDescription: "Non-final action - mailed", usRegistrationDate: undefined, statusDate: "2024-06-01", officeActionResponseDueDate: "2024-09-01" });
export const published = tsdr({ status: 686, statusDescription: "Published for opposition", usRegistrationDate: undefined, publicationDate: "2024-08-20", statusDate: "2024-08-20" });
export const abandoned = tsdr({ status: 602, statusDescription: "Abandoned - failure to respond or late response", usRegistrationDate: undefined, abandonDate: "2024-12-01T00:00:00-05:00", statusDate: "2024-12-01" });
export const unknownStatus = tsdr({ status: 999, statusDescription: "Something new the USPTO invented", usRegistrationDate: undefined });
export const badShape = { trademarks: [{ nope: true }] };
