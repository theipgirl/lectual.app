/**
 * The Meetings banner when a source stopped working: names the source in plain words
 * ("Your Fathom connection needs to be reconnected. New meetings aren't coming in.").
 */
export function reconnectSentence(providers: readonly string[]): string {
  const names = providers.length > 1 ? `${providers.slice(0, -1).join(", ")} and ${providers[providers.length - 1]}` : (providers[0] ?? "Your meeting");
  const noun = providers.length > 1 ? "connections need" : "connection needs";
  return `Your ${names} ${noun} to be reconnected. New meetings aren't coming in.`;
}
