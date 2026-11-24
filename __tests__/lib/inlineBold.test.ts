import { describe, it, expect } from 'vitest';
import { splitBold, stripBold } from '../../lib/inlineBold';

describe('splitBold', () => {
  it('returns a single plain segment when there is no marker', () => {
    expect(splitBold('Automated tests')).toEqual([{ text: 'Automated tests', bold: false }]);
  });

  it('splits *words* into bold segments', () => {
    expect(splitBold('Led *15 QA engineers* on *CI/CD*')).toEqual([
      { text: 'Led ', bold: false },
      { text: '15 QA engineers', bold: true },
      { text: ' on ', bold: false },
      { text: 'CI/CD', bold: true },
    ]);
  });

  it('keeps a lone or empty marker literal', () => {
    expect(splitBold('5 * 3 = 15')).toEqual([{ text: '5 * 3 = 15', bold: false }]);
    expect(splitBold('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
  });

  it('returns no segment for an empty string', () => {
    expect(splitBold('')).toEqual([]);
  });
});

describe('stripBold', () => {
  it('drops the markers but keeps the text', () => {
    expect(stripBold('Led *15 QA engineers*')).toBe('Led 15 QA engineers');
  });
});
