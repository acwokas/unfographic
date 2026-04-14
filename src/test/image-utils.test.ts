import { describe, expect, it } from 'vitest';
import { expandCropBox } from '@/lib/image-utils';

describe('expandCropBox', () => {
  it('adds generous padding around small icons', () => {
    const expanded = expandCropBox(
      { x: 20, y: 80, width: 40, height: 40 },
      1229,
      690,
      'Target icon',
    );

    expect(expanded.x).toBeLessThan(20);
    expect(expanded.y).toBeLessThan(80);
    expect(expanded.width).toBeGreaterThan(40);
    expect(expanded.height).toBeGreaterThan(40);
  });

  it('clamps expanded crop boxes to image bounds', () => {
    const expanded = expandCropBox(
      { x: 5, y: 5, width: 40, height: 40 },
      100,
      100,
      'Corner logo',
    );

    expect(expanded.x).toBeGreaterThanOrEqual(0);
    expect(expanded.y).toBeGreaterThanOrEqual(0);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(100);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(100);
  });
});
