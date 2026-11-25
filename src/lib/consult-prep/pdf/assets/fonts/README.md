# Brand fonts for the packages PDF

The nine static instances the packages PDF embeds (`src/lib/consult-prep/pdf/render.ts`):

| File | Family | Weight / style | Used for |
|---|---|---|---|
| `PlayfairDisplay-600.ttf` | Playfair Display | 600 | wordmark, headings, tier prices, YOU PAY, card titles |
| `PlayfairDisplay-700.ttf` | Playfair Display | 700 | (loaded for parity with the Python renderer's faces) |
| `PlayfairDisplay-500Italic.ttf` | Playfair Display | 500 italic | (as above) |
| `SourceSerif4-400.ttf` | Source Serif 4 | 400 | body and table text |
| `SourceSerif4-600.ttf` | Source Serif 4 | 600 | section label, discount row |
| `SourceSerif4-700.ttf` | Source Serif 4 | 700 | eyebrows, footer firm name, bold note runs |
| `SourceSerif4-400Italic.ttf` | Source Serif 4 | 400 italic | notes, sub-notes, footnote, estimated value |
| `SourceSerif4-600Italic.ttf` | Source Serif 4 | 600 italic | (loaded for parity) |
| `SourceSerif4-700Italic.ttf` | Source Serif 4 | 700 italic | (loaded for parity) |

Only the glyphs a PDF actually draws are embedded (pdf-lib `subset: true`), so an unused face
costs nothing in the output.

## Where they come from

`theipgirl/lectual-plugin`, `firm/brand/fonts/static/*.woff2` (the same files
`scripts/render_package_proposal.py` embeds). `@pdf-lib/fontkit` cannot decode WOFF2 (that needs
brotli), so they were converted once to TTF and committed here. The conversion only unwraps the
WOFF2 container (`flavor = None`); outlines, metrics and names are unchanged.

## Reproducing the conversion

```bash
pip install fonttools brotli
python3 -I scripts/convert-brand-fonts.py \
  ../lectual-plugin/firm/brand/fonts/static \
  src/lib/consult-prep/pdf/assets/fonts
```

Python is used for this dev-time step only. Nothing at build time or runtime runs it.

## Serverless bundling

The renderer reads these files from disk (`process.cwd()/src/lib/consult-prep/pdf/assets/fonts`).
`next.config.ts` lists `./src/lib/consult-prep/pdf/assets/**/*` in `outputFileTracingIncludes` for
the routes that build the PDF (the two crons and the lead page), so Vercel ships them with those functions.

## Glyph coverage

None of the nine faces has U+2248 (≈) or the check marks U+2713/U+2714. The renderer draws check
marks, dash cells and the "≈" of the estimated-value row as vector paths, never as glyphs. Any
other character a face lacks (emoji, CJK) is drawn as "?" and counted in the render metadata.

## License

SIL Open Font License 1.1, see `OFL.txt` (with both families' copyright and Reserved Font Name
lines). The files are redistributed unmodified apart from the container format, under their
original names, as Google Fonts itself distributes them.
