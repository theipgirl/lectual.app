/**
 * Where a firm's public intake lives. Pure, so the editor and the public
 * `embed.js` side build the same strings.
 *
 *   direct link   <origin>/i/<slug>
 *   embed         <script src="<origin>/embed.js" data-intake="<slug>" async></script>
 */

export function intakePublicUrl(origin: string, slug: string): string {
  return `${origin.replace(/\/+$/, "")}/i/${slug}`;
}

export function intakeEmbedSnippet(origin: string, slug: string): string {
  return `<script src="${origin.replace(/\/+$/, "")}/embed.js" data-intake="${slug}" async></script>`;
}
