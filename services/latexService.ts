import { CVData } from '../types';
import { getLangText, getLangArray, LATEX_TRANSLATIONS } from '../lib/i18n';
import { getFontById } from '../lib/fonts';
import { render } from '../lib/templateEngine';
import { splitBold } from '../lib/inlineBold';
import { loadLatexTemplate } from './templateStorageService';
import rawTemplate from '../templates/cv.mustache?raw';

// Single-pass replacement prevents double-escaping: e.g. \ → \textbackslash{}
// must not have its braces subsequently escaped to \{ \}.
const LATEX_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '&':  '\\&',
  '%':  '\\%',
  '$':  '\\$',
  '#':  '\\#',
  '_':  '\\_',
  '{':  '\\{',
  '}':  '\\}',
  '~':  '\\textasciitilde{}',
  '^':  '\\textasciicircum{}',
};

export const escapeLatex = (str: string): string => {
  if (!str) return '';
  return str.replace(/[\\&%$#_{}~^]/g, (ch) => LATEX_ESCAPE_MAP[ch] ?? ch);
};

// Escapes each segment separately so `*bold*` markers become \textbf{} with escaped content.
const escapeLatexWithBold = (str: string): string =>
  splitBold(str ?? '')
    .map(({ text, bold }) => (bold ? `\\textbf{${escapeLatex(text)}}` : escapeLatex(text)))
    .join('');

const escapeLatexMultiline = (str: string): string => {
  if (!str) return '';
  const lineBreak = ' \\\\';
  return str
    .split('\n')
    .map(line => escapeLatex(line))
    .join(lineBreak + '\n');
};

// Extrait les données base64 d'une data URL
const extractBase64Data = (dataUrl: string | null | undefined): { data: string; extension: string } | null => {
  if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) return null;
  return { data: match[2], extension: match[1] === 'jpeg' ? 'jpg' : match[1] };
};

export interface ContactItem {
  /** fontawesome5 command name, without the leading backslash (e.g. `faPhone`). */
  icon: string;
  /** LaTeX-escaped label shown in the PDF. */
  text: string;
  /** Link target, escaped for `\href`; empty when the item is not a link. */
  url: string;
}

/** "https://www.linkedin.com/in/x/" -> "linkedin.com/in/x" (display only). */
export const displayUrl = (url: string): string =>
  url.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '');

/**
 * Escapes a URL for the first argument of `\href`: only `%` and `#` need it there
 * (hyperref reads the rest verbatim). Adds `https://` when no scheme is given so
 * "linkedin.com/in/x" still produces a working link.
 */
export const hrefUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return '';
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\\/g, '').replace(/([%#])/g, '\\$1');
};

const contact = (icon: string, text: string, url = ''): ContactItem | null =>
  text.trim() ? { icon, text: escapeLatex(text.trim()), url } : null;

export const buildContactRows = (p: CVData['personalInfo']): { left: ContactItem | null; right: ContactItem | null }[] => {
  const phone = (p.phone ?? '').trim();
  const left = [
    contact('faMapMarker*', p.location),
    contact('faPhone', phone, phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : ''),
    contact('faEnvelope', p.email, p.email?.trim() ? hrefUrl(`mailto:${p.email.trim()}`) : ''),
  ].filter((c): c is ContactItem => c !== null);
  const right = [
    contact('faLinkedin', displayUrl(p.linkedin ?? ''), hrefUrl(p.linkedin ?? '')),
    contact('faMedium', displayUrl(p.medium ?? ''), hrefUrl(p.medium ?? '')),
    contact('faGithub', displayUrl(p.github ?? ''), hrefUrl(p.github ?? '')),
  ].filter((c): c is ContactItem => c !== null);
  return Array.from({ length: Math.max(left.length, right.length) }, (_, i) => ({
    left: left[i] ?? null,
    right: right[i] ?? null,
  }));
};

export const getTemplate = (): string => loadLatexTemplate() ?? rawTemplate;

interface LatexTemplateData {
  fontPackage: string;
  hasPhoto: boolean;
  photoExtension: string;
  firstName: string;
  lastName: string;
  title: string;
  availability: string;
  location: string;
  email: string;
  phone: string;
  medium: string;
  linkedin: string;
  github: string;
  /** Header contact grid: personal details on the left, web profiles on the right. */
  contactRows: { left: ContactItem | null; right: ContactItem | null }[];
  summary: string;
  tSkills: string;
  tExperience: string;
  tEducation: string;
  tLanguages: string;
  tTech: string;
  skills: { name: string; items: string }[];
  experience: {
    startDate: string;
    endDate: string;
    role: string;
    company: string;
    location: string;
    description: string[];
    techStack: string;
    hasSpacing: boolean;
  }[];
  education: {
    year: string;
    degree: string;
    school: string;
    location: string;
    description: string;
  }[];
  certifications: {
    year: string;
    title: string;
    issuer: string;
  }[];
  languages: string[];
}

const buildTemplateData = (data: CVData, fontId?: string): LatexTemplateData => {
  const { personalInfo, skills, experience, education, certifications, languages, currentLanguage } = data;
  const t = LATEX_TRANSLATIONS[currentLanguage] ?? LATEX_TRANSLATIONS['fr'];
  const photoData = extractBase64Data(personalInfo.photo);

  return {
    fontPackage: getFontById(fontId).latexPackage,
    hasPhoto: !!photoData,
    photoExtension: photoData?.extension ?? 'jpg',
    firstName: escapeLatex(personalInfo.firstName),
    lastName: escapeLatex(personalInfo.lastName),
    title: escapeLatex(getLangText(personalInfo.title, currentLanguage)),
    availability: escapeLatex(getLangText(personalInfo.availability, currentLanguage)),
    location: escapeLatex(personalInfo.location),
    email: escapeLatex(personalInfo.email),
    phone: escapeLatex(personalInfo.phone ?? ''),
    contactRows: buildContactRows(personalInfo),
    medium: escapeLatex(personalInfo.medium),
    linkedin: escapeLatex(personalInfo.linkedin),
    github: escapeLatex(personalInfo.github),
    summary: escapeLatexMultiline(getLangText(personalInfo.summary, currentLanguage)),
    tSkills: t.skills,
    tExperience: t.experience,
    tEducation: t.education,
    tLanguages: t.languages,
    tTech: t.tech,
    skills: skills.map(s => ({
      name: escapeLatex(getLangText(s.name, currentLanguage)),
      items: escapeLatex(getLangText(s.items, currentLanguage)),
    })),
    experience: experience.map((exp, i) => ({
      startDate: escapeLatex(getLangText(exp.startDate, currentLanguage)),
      endDate: escapeLatex(getLangText(exp.endDate, currentLanguage)),
      role: escapeLatex(getLangText(exp.role, currentLanguage)),
      company: escapeLatex(exp.company),
      location: escapeLatex(exp.location),
      description: getLangArray(exp.description, currentLanguage).map(escapeLatexWithBold),
      techStack: escapeLatex(exp.techStack),
      hasSpacing: i < experience.length - 1,
    })),
    education: education.map(edu => ({
      year: escapeLatex(edu.year),
      degree: escapeLatex(getLangText(edu.degree, currentLanguage)),
      school: escapeLatex(edu.school),
      location: escapeLatex(edu.location),
      description: escapeLatex(getLangText(edu.description, currentLanguage)),
    })),
    certifications: (certifications ?? []).map(cert => ({
      year: escapeLatex(cert.year),
      title: escapeLatex(getLangText(cert.title, currentLanguage)),
      issuer: escapeLatex(cert.issuer),
    })),
    languages: getLangArray(languages, currentLanguage).map(escapeLatex),
  };
};

export const generateLatex = (data: CVData, template?: string, fontId?: string): string => {
  const tpl = template ?? getTemplate();
  return render(tpl, buildTemplateData(data, fontId));
};

// Export pour le serveur: retourne le LaTeX + les données de photo si disponible
export const generateLatexWithPhoto = (data: CVData, fontId?: string): { latex: string; photoData: { data: string; extension: string } | null } => {
  const photoData = extractBase64Data(data.personalInfo.photo);
  return {
    latex: generateLatex(data, undefined, fontId),
    photoData
  };
};
