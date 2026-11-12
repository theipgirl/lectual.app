/**
 * Saves PDF bytes the server action returned (base64) through a Blob link, so the download works on the firm's own domain with
 * no new route. Browser only. Returns false when the bytes could not be decoded or the browser refused to save.
 */
export function saveBase64Pdf(base64: string, filename: string): boolean {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked a moment later so the browser has started the save.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}
