import { describe, expect, it } from 'vitest';
import { mapStrokeCap } from '../../src/figma/convert/mappers';
import { ReportBuilder } from '../../src/figma/convert/report';

const ctx = () => ({ report: new ReportBuilder(), nodeId: 'n', path: 'n' });

describe('Figma stroke caps', () => {
  it('keeps the caps Pigma draws: the plain ends, the two arrows, and the three filled ends, with no report', () => {
    for (const cap of ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL', 'TRIANGLE_FILLED', 'DIAMOND_FILLED', 'CIRCLE_FILLED']) {
      const context = ctx();
      expect(mapStrokeCap(cap, context)).toBe(cap);
      expect(context.report.unsupported).toEqual([]);
    }
  });

  it('reports an arrow cap it does not know, and draws it as arrow lines', () => {
    const context = ctx();
    expect(mapStrokeCap('TRIANGLE_ARROW', context)).toBe('ARROW_LINES');
    expect(context.report.unsupported).toHaveLength(1);
  });

  it('leaves a cap it does not know undrawn, with no value', () => {
    expect(mapStrokeCap('SOMETHING_ELSE', ctx())).toBeUndefined();
  });
});
