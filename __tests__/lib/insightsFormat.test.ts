import { describe, it, expect } from 'vitest';
import { formatPercent, formatDays, median, mean } from '../../lib/insightsFormat';

describe('formatPercent', () => {
  it('rounds to the nearest integer percent', () => {
    expect(formatPercent(0.456)).toBe('46 %');
    expect(formatPercent(1)).toBe('100 %');
    expect(formatPercent(0)).toBe('0 %');
  });
});

describe('formatDays', () => {
  it('shows "< 1 j" for less than a day', () => {
    expect(formatDays(0)).toBe('< 1 j');
    expect(formatDays(0.4)).toBe('< 1 j');
  });

  it('rounds whole days', () => {
    expect(formatDays(1)).toBe('1 j');
    expect(formatDays(4.6)).toBe('5 j');
  });
});

describe('median', () => {
  it('returns undefined for an empty array', () => {
    expect(median([])).toBeUndefined();
  });

  it('returns the middle value for an odd-length array', () => {
    expect(median([1, 5, 3])).toBe(3);
  });

  it('averages the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('mean', () => {
  it('returns undefined for an empty array', () => {
    expect(mean([])).toBeUndefined();
  });

  it('averages the values', () => {
    expect(mean([1, 2, 3])).toBe(2);
  });
});
