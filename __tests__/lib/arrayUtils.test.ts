import { describe, it, expect } from 'vitest';
import { moveItem } from '../../lib/arrayUtils';

describe('moveItem', () => {
  it('moves an item up', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'c', 'b']);
  });

  it('moves an item down', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('moves an item across several positions', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns an unchanged copy for out-of-range indices', () => {
    const items = ['a', 'b'];
    expect(moveItem(items, 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(items, 1, 2)).toEqual(['a', 'b']);
    expect(moveItem(items, 5, 0)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c'];
    const result = moveItem(items, 0, 2);
    expect(items).toEqual(['a', 'b', 'c']);
    expect(result).not.toBe(items);
  });
});
