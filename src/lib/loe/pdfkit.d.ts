// pdfkit 0.20 ships no type declarations; this is the part of its API the letter builder uses.
declare module "pdfkit" {
  const PDFDocument: new (options?: Record<string, unknown>) => PDFKit.PDFDocument;
  export default PDFDocument;
}

declare namespace PDFKit {
  interface PDFDocument {
    x: number;
    y: number;
    page: { width: number; height: number; margins: { top: number; bottom: number; left: number; right: number } };
    on(event: string, handler: (...args: never[]) => void): this;
    registerFont(name: string, src: Buffer | string): this;
    font(name: string): this;
    fontSize(size: number): this;
    fillColor(color: string): this;
    strokeColor(color: string): this;
    lineWidth(width: number): this;
    text(text: string, x?: number | Record<string, unknown>, y?: number | Record<string, unknown>, options?: Record<string, unknown>): this;
    image(src: Buffer, x?: number, y?: number, options?: Record<string, unknown>): this;
    moveDown(lines?: number): this;
    moveTo(x: number, y: number): this;
    lineTo(x: number, y: number): this;
    stroke(): this;
    addPage(): this;
    bufferedPageRange(): { start: number; count: number };
    switchToPage(index: number): this;
    end(): void;
  }
}
