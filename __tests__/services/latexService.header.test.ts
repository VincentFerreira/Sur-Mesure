import { describe, it, expect } from 'vitest';
import { generateLatex, buildContactRows, displayUrl, hrefUrl } from '../../services/latexService';
import cvComplet from '../../tests/fixtures/cv-complet.json';
import type { CVData } from '../../types';

const base = cvComplet as unknown as CVData;
const withInfo = (info: Partial<CVData['personalInfo']>): CVData => ({
  ...base,
  personalInfo: { ...base.personalInfo, ...info },
});

describe('displayUrl', () => {
  it('strips scheme, www and trailing slash', () => {
    expect(displayUrl('https://www.linkedin.com/in/jane-doe/')).toBe('linkedin.com/in/jane-doe');
    expect(displayUrl('http://github.com/jane')).toBe('github.com/jane');
  });
});

describe('hrefUrl', () => {
  it('adds https:// when no scheme is given', () => {
    expect(hrefUrl('linkedin.com/in/jane')).toBe('https://linkedin.com/in/jane');
  });

  it('keeps an existing scheme', () => {
    expect(hrefUrl('mailto:jane@example.com')).toBe('mailto:jane@example.com');
  });

  it('escapes % and # for \\href', () => {
    expect(hrefUrl('https://x.com/a%20b#top')).toBe('https://x.com/a\\%20b\\#top');
  });

  it('returns an empty string for an empty URL', () => {
    expect(hrefUrl('   ')).toBe('');
  });
});

describe('buildContactRows', () => {
  it('puts personal details on the left and web profiles on the right', () => {
    const rows = buildContactRows(withInfo({
      phone: '+33 6 12 34 56 78',
      email: 'jane@example.com',
      location: 'Nantes',
      linkedin: 'https://www.linkedin.com/in/jane',
      github: 'https://github.com/jane',
      medium: 'https://medium.com/@jane',
    }).personalInfo);

    expect(rows.map(r => r.left?.icon)).toEqual(['faMapMarker*', 'faPhone', 'faEnvelope']);
    expect(rows.map(r => r.right?.icon)).toEqual(['faLinkedin', 'faMedium', 'faGithub']);
    expect(rows[1].left).toEqual({ icon: 'faPhone', text: '+33 6 12 34 56 78', url: 'tel:+33612345678' });
    expect(rows[2].left?.url).toBe('mailto:jane@example.com');
    expect(rows[0].left?.url).toBe('');
    expect(rows[0].right).toEqual({ icon: 'faLinkedin', text: 'linkedin.com/in/jane', url: 'https://www.linkedin.com/in/jane' });
  });

  it('skips empty fields without leaving holes in a column', () => {
    const rows = buildContactRows(withInfo({
      phone: '', email: 'jane@example.com', location: '', linkedin: '', github: 'github.com/jane', medium: '',
    }).personalInfo);
    expect(rows).toHaveLength(1);
    expect(rows[0].left?.icon).toBe('faEnvelope');
    expect(rows[0].right?.icon).toBe('faGithub');
  });

  it('treats a missing phone (CVs created before the field existed) as empty', () => {
    const { phone: _ignored, ...info } = withInfo({}).personalInfo;
    const rows = buildContactRows(info as CVData['personalInfo']);
    expect(rows.every(r => r.left?.icon !== 'faPhone')).toBe(true);
  });

  it('escapes LaTeX special characters in the displayed text', () => {
    const rows = buildContactRows(withInfo({ location: 'R&D_Lab', phone: '', email: '' }).personalInfo);
    expect(rows[0].left?.text).toBe('R\\&D\\_Lab');
  });
});

describe('generateLatex — header', () => {
  it('renders the phone as a tel: link next to the email', () => {
    const latex = generateLatex(withInfo({ phone: '06 12 34 56 78' }), undefined);
    expect(latex).toContain('\\contacticon{\\faPhone}\\href{tel:0612345678}{06 12 34 56 78}');
    expect(latex.indexOf('\\faPhone')).toBeLessThan(latex.indexOf('\\faEnvelope'));
  });

  it('hides link borders', () => {
    expect(generateLatex(base)).toContain('\\hypersetup{hidelinks}');
  });

  it('leaves no unrendered template tags in the header', () => {
    expect(generateLatex(withInfo({ phone: '' }))).not.toMatch(/\[\[|\]\]/);
  });
});
