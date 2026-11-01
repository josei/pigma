import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { figmaRestToPigmaFile } from '../../src/figma/convert/convert';
import { parseFigmaRestFile } from '../../src/figma/rest/parse';

const NOW = 1_700_000_000_000;
const json = (name: string): any => JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8'));

/** The fixture's Ellipse (1:5) with its arc data replaced, converted; the report comes with it. */
function convertedEllipse(arcData: unknown) {
  const input = json('rest-file.json');
  const walk = (node: any): void => {
    if (node.id === '1:5') node.arcData = arcData;
    for (const child of node.children ?? []) walk(child);
  };
  walk(input.document);
  return figmaRestToPigmaFile(parseFigmaRestFile(input), { now: () => NOW }).report;
}

describe('REST ellipse arc data in the import report', () => {
  it('reports a partial arc or a hole as unsupported, since Pigma draws whole ellipses', () => {
    const report = convertedEllipse({ startingAngle: 0, endingAngle: 4.71238898, innerRadius: 0.5 });
    expect(report.unsupported.some((item) => item.feature === 'ellipse:arcData')).toBe(true);
  });

  it('reports a sector with no hole as unsupported, though it is not a full circle', () => {
    const report = convertedEllipse({ startingAngle: 0, endingAngle: Math.PI, innerRadius: 0 });
    expect(report.unsupported.some((item) => item.feature === 'ellipse:arcData')).toBe(true);
  });

  it('does not report a full circle with no hole, which Figma writes for a plain ellipse', () => {
    // Figma's own ellipses carry the arc data of a full circle: 0 to 2 pi as float32, and no inner radius.
    const report = convertedEllipse({ startingAngle: 0, endingAngle: 6.2831854820251465, innerRadius: 0 });
    expect(report.unsupported.some((item) => item.feature === 'ellipse:arcData')).toBe(false);
  });
});
