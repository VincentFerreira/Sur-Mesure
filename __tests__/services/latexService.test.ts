import { describe, it, expect } from 'vitest';
import { generateLatex, generateLatexWithPhoto } from '../../services/latexService';
import { getFontById, DEFAULT_FONT_ID } from '../../lib/fonts';
import type { CVData } from '../../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const makeCV = (overrides: Partial<CVData> = {}): CVData => ({
  currentLanguage: 'fr',
  personalInfo: {
    firstName: 'Jean',
    lastName: 'DUPONT',
    title: { fr: 'Développeur Full Stack', en: 'Full Stack Developer' },
    email: 'jean@example.com',
    medium: 'medium.com/@jean',
    location: 'Paris, France',
    linkedin: 'linkedin.com/in/jean',
    github: 'github.com/jean',
    photo: null,
    summary: { fr: 'Développeur passionné.', en: 'Passionate developer.' },
  },
  skills: [
    {
      id: '1',
      name: { fr: 'Programmation', en: 'Programming' },
      items: { fr: 'TypeScript, React', en: 'TypeScript, React' },
    },
  ],
  experience: [
    {
      id: 'exp1',
      role: { fr: 'Développeur', en: 'Developer' },
      company: 'Acme Corp',
      location: 'Paris',
      startDate: { fr: 'Janvier 2022', en: 'January 2022' },
      endDate: { fr: "Aujourd'hui", en: 'Today' },
      description: { fr: ['Développé des features'], en: ['Developed features'] },
      techStack: 'React, Node.js',
    },
  ],
  education: [
    {
      id: 'edu1',
      degree: { fr: 'Licence Informatique', en: 'BSc Computer Science' },
      school: 'Université Paris',
      location: 'France',
      startDate: '2018',
      endDate: '2021',
      description: { fr: 'Option IA', en: 'AI option' },
    },
  ],
  certifications: [
    {
      id: 'cert1',
      title: { fr: 'AWS Certified Solutions Architect', en: 'AWS Certified Solutions Architect' },
      issuer: 'Amazon Web Services',
      year: '2022',
    },
  ],
  languages: { fr: ['Français (Natif)', 'Anglais (Courant)'], en: ['French (Native)', 'English (Fluent)'] },
  ...overrides,
});

// ── Document structure ────────────────────────────────────────────────────────

describe('generateLatex — document structure', () => {
  it('produces a valid LaTeX document skeleton', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('\\documentclass');
    expect(latex).toContain('\\begin{document}');
    expect(latex).toContain('\\end{document}');
  });

  it('includes all four CV sections', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('\\cvsection{');
  });

  it('starts with \\documentclass and ends with \\end{document}', () => {
    const latex = generateLatex(makeCV()).trim();
    expect(latex.startsWith('\\documentclass')).toBe(true);
    expect(latex.endsWith('\\end{document}')).toBe(true);
  });
});

// ── Content ───────────────────────────────────────────────────────────────────

describe('generateLatex — content', () => {
  it('includes the first and last name', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('Jean');
    expect(latex).toContain('DUPONT');
  });

  it('includes the email address', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('jean@example.com');
  });

  it('includes the company name from experience', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('Acme Corp');
  });

  it('includes the school name from education', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('Université Paris');
  });

  it('includes the tech stack', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('React, Node.js');
  });

  it('includes all language entries', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('Français (Natif)');
    expect(latex).toContain('Anglais (Courant)');
  });

  it('omits GitHub icon line when github is empty', () => {
    const cv = makeCV();
    cv.personalInfo.github = '';
    const latex = generateLatex(cv);
    expect(latex).not.toContain('\\faGithub');
  });

  it('includes GitHub icon line when github is set', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('\\faGithub');
  });
});

// ── Language switching ────────────────────────────────────────────────────────

describe('generateLatex — language switching', () => {
  it('uses French section headers when currentLanguage is fr', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'fr' }));
    expect(latex).toContain('Compétences');
    expect(latex).toContain('Expérience');
    expect(latex).toContain('Éducation');
    expect(latex).toContain('Langues');
  });

  it('uses English section headers when currentLanguage is en', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'en' }));
    expect(latex).toContain('Skills');
    expect(latex).toContain('Experience');
    expect(latex).toContain('Education');
    expect(latex).toContain('Languages');
  });

  it('renders the French role when currentLanguage is fr', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'fr' }));
    expect(latex).toContain('Développeur');
    expect(latex).not.toContain('Developer');
  });

  it('renders the English role when currentLanguage is en', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'en' }));
    expect(latex).toContain('Developer');
  });

  it('renders French description bullets when currentLanguage is fr', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'fr' }));
    expect(latex).toContain('Développé des features');
  });

  it('renders English description bullets when currentLanguage is en', () => {
    const latex = generateLatex(makeCV({ currentLanguage: 'en' }));
    expect(latex).toContain('Developed features');
  });
});

// ── LaTeX escaping ────────────────────────────────────────────────────────────

describe('generateLatex — LaTeX special-character escaping', () => {
  const specialChars: Array<[string, string]> = [
    ['&', '\\&'],
    ['%', '\\%'],
    ['$', '\\$'],
    ['#', '\\#'],
    ['_', '\\_'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['~', '\\textasciitilde{}'],
    ['^', '\\textasciicircum{}'],
    ['\\', '\\textbackslash{}'],
  ];

  for (const [raw, escaped] of specialChars) {
    it(`escapes '${raw}' → '${escaped}' in personal info fields`, () => {
      const cv = makeCV();
      cv.personalInfo.location = `City${raw}Country`;
      const latex = generateLatex(cv);
      expect(latex).toContain(`City${escaped}Country`);
      expect(latex).not.toContain(`City${raw}Country`);
    });
  }

  it('escapes special chars inside skill items', () => {
    const cv = makeCV();
    cv.skills[0].items = { fr: 'C++ & Python', en: 'C++ & Python' };
    const latex = generateLatex(cv);
    // The literal unescaped sequence should not appear in the items value
    expect(latex).not.toContain('C++ & Python');
    // The escaped form should appear
    expect(latex).toContain('C++ \\& Python');
  });

  it('escapes special chars in experience descriptions', () => {
    const cv = makeCV();
    cv.experience[0].description = { fr: ['Taux de couverture : 80%'], en: ['Coverage: 80%'] };
    const latex = generateLatex(cv);
    expect(latex).toContain('80\\%');
  });

  it('does not double-escape backslashes', () => {
    const cv = makeCV();
    cv.personalInfo.location = 'C:\\path';
    const latex = generateLatex(cv);
    // Each \ becomes \textbackslash{} — no further escaping of that output
    expect(latex).toContain('C:\\textbackslash{}path');
  });
});

// ── Photo handling ────────────────────────────────────────────────────────────

describe('generateLatex — photo', () => {
  it('uses full-width minipage when no photo is set', () => {
    const latex = generateLatex(makeCV());
    expect(latex).toContain('\\begin{minipage}{\\textwidth}');
  });

  it('uses split minipages when a valid JPEG photo is provided', () => {
    const cv = makeCV();
    cv.personalInfo.photo = 'data:image/jpeg;base64,/9j/abc123';
    const latex = generateLatex(cv);
    expect(latex).toContain('0.22\\textwidth');
    expect(latex).toContain('photo.jpg');
  });

  it('uses split minipages when a valid PNG photo is provided', () => {
    const cv = makeCV();
    cv.personalInfo.photo = 'data:image/png;base64,iVBORw0KGgo=';
    const latex = generateLatex(cv);
    expect(latex).toContain('photo.png');
  });

  it('falls back to full-width minipage for an invalid data URL', () => {
    const cv = makeCV();
    cv.personalInfo.photo = 'https://picsum.photos/200/200';
    const latex = generateLatex(cv);
    expect(latex).toContain('\\begin{minipage}{\\textwidth}');
  });
});

// ── escapeLatexMultiline ──────────────────────────────────────────────────────

describe('generateLatex — escapeLatexMultiline via summary', () => {
  it('joins multiline text with LaTeX line breaks', () => {
    const cv = makeCV();
    cv.personalInfo.summary = { fr: 'Ligne 1\nLigne 2', en: 'Line 1\nLine 2' };
    const latex = generateLatex(cv);
    expect(latex).toContain('Ligne 1 \\\\\nLigne 2');
  });

  it('escapes special chars on each line independently', () => {
    const cv = makeCV();
    cv.personalInfo.summary = { fr: 'Taux: 80%\nScore: 100%', en: '' };
    const latex = generateLatex(cv);
    expect(latex).toContain('Taux: 80\\%');
    expect(latex).toContain('Score: 100\\%');
  });

  it('returns empty string for empty summary', () => {
    const cv = makeCV();
    cv.personalInfo.summary = { fr: '', en: '' };
    const latex = generateLatex(cv);
    expect(latex).toContain('\\end{document}');
  });
});

// ── Edge cases: empty arrays ──────────────────────────────────────────────────

describe('generateLatex — empty arrays', () => {
  it('produces valid LaTeX with no skills', () => {
    const cv = makeCV({ skills: [] });
    const latex = generateLatex(cv);
    expect(latex).toContain('\\begin{document}');
    expect(latex).toContain('\\end{document}');
    expect(latex).toContain('\\end{tabularx}');
  });

  it('produces valid LaTeX with no experience entries', () => {
    const cv = makeCV({ experience: [] });
    const latex = generateLatex(cv);
    expect(latex).toContain('\\cvsection{');
    expect(latex).toContain('\\end{document}');
  });

  it('produces valid LaTeX with no education entries', () => {
    const cv = makeCV({ education: [] });
    const latex = generateLatex(cv);
    expect(latex).toContain('\\end{tabularx}');
    expect(latex).toContain('\\end{document}');
  });

  it('produces valid LaTeX with empty languages', () => {
    const cv = makeCV({ languages: { fr: [], en: [] } });
    const latex = generateLatex(cv);
    expect(latex).toContain('\\end{itemize}');
    expect(latex).toContain('\\end{document}');
  });
});

// ── Edge cases: missing optional fields ──────────────────────────────────────

describe('generateLatex — missing optional fields', () => {
  it('omits tech stack line gracefully when techStack is empty', () => {
    const cv = makeCV();
    cv.experience[0].techStack = '';
    const latex = generateLatex(cv);
    expect(latex).toContain('\\end{document}');
    expect(latex).toContain('\\begin{document}');
  });

  it('renders correctly when location is empty', () => {
    const cv = makeCV();
    cv.personalInfo.location = '';
    const latex = generateLatex(cv);
    expect(latex).toContain('\\faMapMarker*');
    expect(latex).not.toContain('{Paris, France}');
  });

  it('renders correctly when medium is empty', () => {
    const cv = makeCV();
    cv.personalInfo.medium = '';
    const latex = generateLatex(cv);
    expect(latex).toContain('\\faMedium');
  });
});

// ── generateLatexWithPhoto ────────────────────────────────────────────────────

describe('generateLatexWithPhoto', () => {
  it('returns an object with latex and photoData keys', () => {
    const result = generateLatexWithPhoto(makeCV());
    expect(result).toHaveProperty('latex');
    expect(result).toHaveProperty('photoData');
  });

  it('photoData is null when no photo is set', () => {
    const { photoData } = generateLatexWithPhoto(makeCV());
    expect(photoData).toBeNull();
  });

  it('photoData contains data and extension when a photo is set', () => {
    const cv = makeCV();
    cv.personalInfo.photo = 'data:image/png;base64,iVBORw0KGgo=';
    const { photoData } = generateLatexWithPhoto(cv);
    expect(photoData).not.toBeNull();
    expect(photoData!.extension).toBe('png');
    expect(photoData!.data).toBe('iVBORw0KGgo=');
  });

  it('normalises jpeg extension to jpg', () => {
    const cv = makeCV();
    cv.personalInfo.photo = 'data:image/jpeg;base64,/9j/abc';
    const { photoData } = generateLatexWithPhoto(cv);
    expect(photoData!.extension).toBe('jpg');
  });

  it('latex output is identical to generateLatex output', () => {
    const cv = makeCV();
    expect(generateLatexWithPhoto(cv).latex).toBe(generateLatex(cv));
  });
});

// ── Font selection ────────────────────────────────────────────────────────────

describe('generateLatex — font selection', () => {
  it('uses the default font package when no fontId is passed', () => {
    const cv = makeCV();
    const latex = generateLatex(cv);
    expect(latex).toContain(getFontById(DEFAULT_FONT_ID).latexPackage);
  });

  it('uses the given font\'s package when a fontId is passed', () => {
    const cv = makeCV();
    const latex = generateLatex(cv, undefined, 'charter');
    expect(latex).toContain(getFontById('charter').latexPackage);
    expect(latex).not.toContain(getFontById(DEFAULT_FONT_ID).latexPackage);
  });

  it('falls back to the default font for an unknown fontId', () => {
    const cv = makeCV();
    const latex = generateLatex(cv, undefined, 'not-a-real-font');
    expect(latex).toContain(getFontById(DEFAULT_FONT_ID).latexPackage);
  });

  it('threads fontId through generateLatexWithPhoto', () => {
    const cv = makeCV();
    const { latex } = generateLatexWithPhoto(cv, 'times');
    expect(latex).toContain(getFontById('times').latexPackage);
  });
});
