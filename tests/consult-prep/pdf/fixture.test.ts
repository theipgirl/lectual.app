// The visual fixture check. Writes the LegacyCon packages PDF (and, with
// PACKAGES_FIXTURE_STRESS=1, the stress renders beside it) to the path in
// PACKAGES_FIXTURE_OUT, for rasterizing with pdftoppm and comparing with the
// reference. Skipped when the variable is unset, so `npx vitest run` writes
// nothing.
//
//   PACKAGES_FIXTURE_OUT=out/packages-fixture.pdf npx vitest run tests/consult-prep/pdf/fixture.test.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderPackagesPdf } from '@/lib/consult-prep/pdf/render';
import { buildPackagesSpec } from '@/lib/consult-prep/pdf/spec';
import { LEGACYCON_INPUT, RPB_FIRM, STRESS_INPUTS } from './fixtures';

const OUT = process.env.PACKAGES_FIXTURE_OUT;

describe.skipIf(!OUT)('packages PDF fixture', () => {
  it('writes the LegacyCon fixture PDF', async () => {
    const out = path.resolve(OUT!);
    mkdirSync(path.dirname(out), { recursive: true });
    const bytes = await renderPackagesPdf(buildPackagesSpec(LEGACYCON_INPUT, RPB_FIRM));
    writeFileSync(out, bytes);
    const pages = (await PDFDocument.load(bytes)).getPageCount();
    console.log(`packages fixture: ${bytes.length} bytes, ${pages} pages`);
    expect(pages).toBe(2);
  });

  it.skipIf(!process.env.PACKAGES_FIXTURE_STRESS)('writes the stress renders', async () => {
    const out = path.resolve(OUT!);
    for (const [name, input] of Object.entries(STRESS_INPUTS)) {
      const bytes = await renderPackagesPdf(buildPackagesSpec(input, RPB_FIRM));
      const file = out.replace(/\.pdf$/, '') + `-${name}.pdf`;
      writeFileSync(file, bytes);
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      console.log(`packages stress ${name}: ${bytes.length} bytes, ${pages} pages`);
      expect(pages).toBe(2);
    }
  });
});
