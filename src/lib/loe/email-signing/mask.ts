/**
 * The address the link went to, masked for the page ("s•••@example.com", Sprint A D9): the proposal link is a bearer link and
 * need not reveal the full address (open question Q3). Pure.
 */
export function maskEmail(address: string): string {
  const v = address.trim();
  const at = v.lastIndexOf("@");
  if (at <= 0) return "•••";
  return `${v.slice(0, 1)}•••${v.slice(at)}`;
}
