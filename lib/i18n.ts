// Single source of truth for all language configuration.
// To add a language: add its code to LANGUAGE_CODES, add its metadata to LANGUAGES,
// then add its translations to UI_TRANSLATIONS and LATEX_TRANSLATIONS.
// TypeScript will report every missing key at compile time.

export const LANGUAGE_CODES = ['fr', 'en'] as const;
export type Language = (typeof LANGUAGE_CODES)[number];

export interface LanguageMeta {
  code: Language;
  label: string;   // Short label for the switcher button, e.g. "FR"
  locale: string;  // BCP 47 locale for date formatting, e.g. "fr-FR"
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'fr', label: 'FR', locale: 'fr-FR' },
  { code: 'en', label: 'EN', locale: 'en-US' },
];

export const DEFAULT_LANGUAGE: Language = 'fr';

// ---------------------------------------------------------------------------
// Safe accessors with fallback
// ---------------------------------------------------------------------------

export function getLangText(
  field: Partial<Record<string, string>> | undefined | null,
  lang: Language
): string {
  if (!field) return '';
  return field[lang] ?? field[DEFAULT_LANGUAGE] ?? Object.values(field).find(Boolean) ?? '';
}

export function getLangArray(
  field: Partial<Record<string, string[]>> | undefined | null,
  lang: Language
): string[] {
  if (!field) return [];
  return field[lang] ?? field[DEFAULT_LANGUAGE] ?? [];
}

// ---------------------------------------------------------------------------
// Factory helpers — new data items are initialised for every known language
// ---------------------------------------------------------------------------

export function createMultiLangString(
  values: Partial<Record<Language, string>> = {}
): Partial<Record<Language, string>> {
  const result: Partial<Record<Language, string>> = {};
  for (const code of LANGUAGE_CODES) {
    result[code] = values[code] ?? '';
  }
  return result;
}

export function createMultiLangArray(
  values: Partial<Record<Language, string[]>> = {}
): Partial<Record<Language, string[]>> {
  const result: Partial<Record<Language, string[]>> = {};
  for (const code of LANGUAGE_CODES) {
    result[code] = values[code] ?? [];
  }
  return result;
}

// ---------------------------------------------------------------------------
// UI translations — editor labels, placeholders, section titles
// ---------------------------------------------------------------------------

export interface UITranslations {
  // Section headers (editor sidebar)
  personalInfo: string;
  skillsSection: string;
  experienceSection: string;
  educationSection: string;
  languagesSection: string;
  // Personal form
  firstName: string;
  lastName: string;
  jobTitle: string;
  availabilityLabel: string;
  changePhoto: string;
  photoLoaded: string;
  professionalSummary: string;
  address: string;
  phoneLabel: string;
  // Skills
  categoryPlaceholder: string;
  skillsListPlaceholder: string;
  addCategory: string;
  // Experience
  addExperience: string;
  experienceLabel: string;
  roleLabel: string;
  companyLabel: string;
  startDateLabel: string;
  endDateLabel: string;
  locationLabel: string;
  responsibilitiesLabel: string;
  addLine: string;
  moveUp: string;
  moveDown: string;
  commaSeparated: string;
  // Education
  addEducation: string;
  educationLabel: string;
  degreeLabel: string;
  schoolLabel: string;
  startLabel: string;
  endLabel: string;
  // Certifications
  certificationsSection: string;
  addCertification: string;
  certificationLabel: string;
  certificationTitleLabel: string;
  issuerLabel: string;
  yearLabel: string;
  // Personal projects
  projectsSection: string;
  addProject: string;
  projectLabel: string;
  projectNameLabel: string;
  projectUrlLabel: string;
  // Languages list
  addLanguage: string;
  languagePlaceholder: string;
  // Default content for newly created items
  newCategory: string;
  newRole: string;
  newTask: string;
  newLanguageItem: string;
  // Preview section headings (rendered in the CV preview)
  previewSkills: string;
  previewExperience: string;
  previewEducation: string;
  previewProjects: string;
  previewLanguages: string;
  previewTech: string;
  noPhoto: string;
}

export const UI_TRANSLATIONS: Record<Language, UITranslations> = {
  fr: {
    personalInfo: "Informations Personnelles",
    skillsSection: "Compétences",
    experienceSection: "Expérience Professionnelle",
    educationSection: "Éducation",
    languagesSection: "Langues",
    firstName: "Prénom",
    lastName: "Nom",
    jobTitle: "Titre du poste",
    availabilityLabel: "Disponibilité",
    changePhoto: "Changer la photo",
    photoLoaded: "Photo chargée",
    professionalSummary: "Résumé professionnel",
    address: "Adresse",
    phoneLabel: "Téléphone",
    categoryPlaceholder: "Catégorie (ex: Frameworks)",
    skillsListPlaceholder: "Liste des compétences séparées par des virgules",
    addCategory: "Ajouter une catégorie",
    addExperience: "Ajouter une expérience",
    experienceLabel: "Expérience",
    roleLabel: "Rôle",
    companyLabel: "Entreprise",
    startDateLabel: "Date début",
    endDateLabel: "Date fin",
    locationLabel: "Lieu",
    responsibilitiesLabel: "Responsabilités",
    addLine: "Ajouter une ligne",
    moveUp: "Monter",
    moveDown: "Descendre",
    commaSeparated: "séparé par virgules",
    addEducation: "Ajouter une formation",
    educationLabel: "Formation",
    degreeLabel: "Diplôme",
    schoolLabel: "École",
    startLabel: "Début",
    endLabel: "Fin",
    certificationsSection: "Certifications",
    addCertification: "Ajouter une certification",
    certificationLabel: "Certification",
    certificationTitleLabel: "Titre",
    issuerLabel: "Organisme",
    yearLabel: "Année",
    projectsSection: "Projets personnels",
    addProject: "Ajouter un projet",
    projectLabel: "Projet",
    projectNameLabel: "Nom du projet",
    projectUrlLabel: "Lien (GitHub, démo…)",
    addLanguage: "Ajouter une langue",
    languagePlaceholder: "Langue (ex: Anglais - Courant)",
    newCategory: "Nouvelle Catégorie",
    newRole: "Nouveau Poste",
    newTask: "Nouvelle tâche...",
    newLanguageItem: "Nouvelle langue",
    previewSkills: "COMPÉTENCES",
    previewExperience: "EXPÉRIENCE PROFESSIONNELLE",
    previewEducation: "FORMATION",
    previewProjects: "PROJETS PERSONNELS",
    previewLanguages: "LANGUES",
    previewTech: "Tech :",
    noPhoto: "Pas de photo",
  },
  en: {
    personalInfo: "Personal Information",
    skillsSection: "Skills",
    experienceSection: "Professional Experience",
    educationSection: "Education",
    languagesSection: "Languages",
    firstName: "First Name",
    lastName: "Last Name",
    jobTitle: "Job Title",
    availabilityLabel: "Availability",
    changePhoto: "Change Photo",
    photoLoaded: "Photo loaded",
    professionalSummary: "Professional Summary",
    address: "Location",
    phoneLabel: "Phone",
    categoryPlaceholder: "Category (e.g. Frameworks)",
    skillsListPlaceholder: "List of skills separated by commas",
    addCategory: "Add category",
    addExperience: "Add experience",
    experienceLabel: "Experience",
    roleLabel: "Role",
    companyLabel: "Company",
    startDateLabel: "Start Date",
    endDateLabel: "End Date",
    locationLabel: "Location",
    responsibilitiesLabel: "Responsibilities",
    addLine: "Add line",
    moveUp: "Move up",
    moveDown: "Move down",
    commaSeparated: "comma separated",
    addEducation: "Add education",
    educationLabel: "Education",
    degreeLabel: "Degree",
    schoolLabel: "School",
    startLabel: "Start",
    endLabel: "End",
    certificationsSection: "Certifications",
    addCertification: "Add certification",
    certificationLabel: "Certification",
    certificationTitleLabel: "Title",
    issuerLabel: "Issuing Organization",
    yearLabel: "Year",
    projectsSection: "Personal Projects",
    addProject: "Add project",
    projectLabel: "Project",
    projectNameLabel: "Project name",
    projectUrlLabel: "Link (GitHub, demo…)",
    addLanguage: "Add language",
    languagePlaceholder: "Language (e.g. English - Fluent)",
    newCategory: "New Category",
    newRole: "New Role",
    newTask: "New task...",
    newLanguageItem: "New language",
    previewSkills: "SKILLS",
    previewExperience: "PROFESSIONAL EXPERIENCE",
    previewEducation: "EDUCATION",
    previewProjects: "PERSONAL PROJECTS",
    previewLanguages: "LANGUAGES",
    previewTech: "Tech:",
    noPhoto: "No Photo",
  },
};

// ---------------------------------------------------------------------------
// LaTeX translations — section headings in the generated .tex output
// ---------------------------------------------------------------------------

export interface LaTeXTranslations {
  skills: string;
  experience: string;
  education: string;
  projects: string;
  tech: string;
  languages: string;
}

export const LATEX_TRANSLATIONS: Record<Language, LaTeXTranslations> = {
  fr: {
    skills: "Compétences",
    experience: "Expérience",
    education: "Formation",
    projects: "Projets personnels",
    tech: "Tech :",
    languages: "Langues",
  },
  en: {
    skills: "Skills",
    experience: "Experience",
    education: "Education",
    projects: "Personal Projects",
    tech: "Tech:",
    languages: "Languages",
  },
};
