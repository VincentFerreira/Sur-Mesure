import { CVData } from '../types';
import { getLangText, getLangArray, LATEX_TRANSLATIONS } from '../lib/i18n';
import { getFontById } from '../lib/fonts';
import { render } from '../lib/templateEngine';
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

export const getTemplate = (): string => loadLatexTemplate() ?? rawTemplate;

interface LatexTemplateData {
  fontPackage: string;
  hasPhoto: boolean;
  photoExtension: string;
  firstName: string;
  lastName: string;
  title: string;
  location: string;
  email: string;
  medium: string;
  linkedin: string;
  github: string;
  summary: string;
  tSkills: string;
  tExperience: string;
  tEducation: string;
  tCertifications: string;
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
    startDate: string;
    endDate: string;
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
    location: escapeLatex(personalInfo.location),
    email: escapeLatex(personalInfo.email),
    medium: escapeLatex(personalInfo.medium),
    linkedin: escapeLatex(personalInfo.linkedin),
    github: escapeLatex(personalInfo.github),
    summary: escapeLatexMultiline(getLangText(personalInfo.summary, currentLanguage)),
    tSkills: t.skills,
    tExperience: t.experience,
    tEducation: t.education,
    tCertifications: t.certifications,
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
      description: getLangArray(exp.description, currentLanguage).map(escapeLatex),
      techStack: escapeLatex(exp.techStack),
      hasSpacing: i < experience.length - 1,
    })),
    education: education.map(edu => ({
      startDate: escapeLatex(edu.startDate),
      endDate: escapeLatex(edu.endDate),
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
