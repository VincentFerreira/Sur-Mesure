import React from 'react';
import { CVData } from '../types';
import { getLangText, getLangArray, UI_TRANSLATIONS, LANGUAGES } from '../lib/i18n';
import { splitBold } from '../lib/inlineBold';
import { Link2, MapPin, Mail, PenLine, Phone } from 'lucide-react';
import { displayUrl } from '../services/latexService';

/** Browser link target: adds https:// when no scheme was typed (no LaTeX escaping here). */
const webHref = (url: string): string => {
  const trimmed = url.trim();
  return /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

// lucide-react dropped brand/logo icons in v1; inlined here instead.
const Linkedin: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124zM7.119 20.452H3.554V9h3.565v11.452z" />
  </svg>
);

const Github: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

interface PreviewProps {
  data: CVData;
}

const Preview: React.FC<PreviewProps> = ({ data }) => {
  const { personalInfo, skills, experience, education, certifications, projects = [], languages, currentLanguage: lang } = data;
  const h = UI_TRANSLATIONS[lang] ?? UI_TRANSLATIONS['fr'];
  const locale = LANGUAGES.find(l => l.code === lang)?.locale ?? 'fr-FR';

  return (
    <div id="cv-preview-export" className="bg-white shadow-2xl w-full max-w-[21cm] min-h-[29.7cm] p-8 md:p-10 mx-auto text-slate-800 font-sans leading-relaxed origin-top scale-[0.6] sm:scale-[0.7] md:scale-[0.8] lg:scale-100 transition-transform duration-300">

      {/* HEADER: Photo Left (Requested), Info Right */}
      <div className="flex flex-row gap-6 mb-8 items-center border-b pb-6 border-slate-200">

        {/* Photo Section (Left) */}
        <div className="w-1/4 flex justify-center flex-shrink-0">
          <div className="w-32 h-32 md:w-40 md:h-40 relative rounded-full overflow-hidden border-4 border-slate-100 shadow-md">
            {personalInfo.photo ? (
              <img
                src={personalInfo.photo}
                alt="Profile"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-slate-200 flex items-center justify-center text-slate-400">
                {h.noPhoto}
              </div>
            )}
          </div>
        </div>

        {/* Text Section (Right) */}
        <div className="flex-1">
          <h1 className="text-4xl font-bold text-slate-800 uppercase tracking-tight">
            {personalInfo.firstName} <span className="text-slate-900">{personalInfo.lastName}</span>
          </h1>
          <h2 className="text-xl text-indigo-600 font-medium mt-1 mb-3">
            {getLangText(personalInfo.title, lang)}
          </h2>
          {getLangText(personalInfo.availability, lang) && (
            <div className="text-sm font-semibold text-indigo-800 -mt-2 mb-3">
              {getLangText(personalInfo.availability, lang)}
            </div>
          )}

          <div className="text-sm text-slate-600 space-y-1">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" /> <span>{personalInfo.location}</span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {personalInfo.phone && (
                <div className="flex items-center gap-2">
                  <Phone className="w-4 h-4" /> <span>{personalInfo.phone}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" /> <span>{personalInfo.email}</span>
              </div>
              {personalInfo.medium && (
                <div className="flex items-center gap-2">
                  <PenLine className="w-4 h-4" /> <span>{personalInfo.medium.replace(/https?:\/\//, '')}</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {personalInfo.linkedin && (
                <div className="flex items-center gap-2">
                  <Linkedin className="w-4 h-4" /> <span>{personalInfo.linkedin.replace(/https?:\/\//, '')}</span>
                </div>
              )}
              {personalInfo.github && (
                <div className="flex items-center gap-2">
                  <Github className="w-4 h-4" /> <span>{personalInfo.github.replace(/https?:\/\//, '')}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="mb-8 text-sm text-slate-600 text-justify whitespace-pre-line">
        {getLangText(personalInfo.summary, lang)}
      </div>

      {/* SKILLS */}
      <div className="mb-8">
        <h3 className="text-xl font-bold text-indigo-800 border-b-2 border-indigo-800 mb-4 flex items-center gap-2">
          <span className="text-2xl">≡</span> {h.previewSkills}
        </h3>
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.id} className="flex flex-col sm:flex-row text-sm">
              <div className="w-full sm:w-40 font-bold text-slate-800 text-right pr-4 mb-1 sm:mb-0">
                {getLangText(skill.name, lang)}
              </div>
              <div className="flex-1 text-slate-600">
                {getLangText(skill.items, lang)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* EXPERIENCE */}
      <div className="mb-8">
        <h3 className="text-xl font-bold text-indigo-800 border-b-2 border-indigo-800 mb-4 flex items-center gap-2">
          <span className="text-2xl">💼</span> {h.previewExperience}
        </h3>
        <div className="space-y-6">
          {experience.map((exp) => (
            <div key={exp.id} className="flex flex-col sm:flex-row">
              <div className="w-full sm:w-40 flex flex-col items-end pr-4 mb-2 sm:mb-0">
                <span className="font-bold text-slate-800 text-sm">{getLangText(exp.startDate, lang)}</span>
                <span className="text-xs text-slate-500">{getLangText(exp.endDate, lang)}</span>
              </div>
              <div className="flex-1 border-l-2 border-slate-200 pl-4 pb-2">
                <div className="font-bold text-base text-slate-800">
                  {getLangText(exp.role, lang)} | <span className="text-slate-600 font-medium">{exp.company}, {exp.location}</span>
                </div>
                <ul className="list-disc list-outside ml-4 mt-2 text-sm text-slate-600 space-y-1">
                  {getLangArray(exp.description, lang).map((desc, idx) => (
                    <li key={idx}>
                      {splitBold(desc).map((seg, i) =>
                        seg.bold ? <strong key={i} className="text-slate-800">{seg.text}</strong> : <React.Fragment key={i}>{seg.text}</React.Fragment>
                      )}
                    </li>
                  ))}
                </ul>
                {exp.techStack && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    <span className="text-xs text-slate-400 self-center mr-1">{h.previewTech}</span>
                    {exp.techStack.split(',').map((tech, idx) => (
                      <span key={idx} className="px-2 py-0.5 bg-slate-100 border border-slate-300 text-slate-600 text-xs rounded-full">
                        {tech.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* PERSONAL PROJECTS */}
      {projects.length > 0 && (
        <div className="mb-8" data-testid="preview-projects">
          <h3 className="text-xl font-bold text-indigo-800 border-b-2 border-indigo-800 mb-4 flex items-center gap-2">
            <span className="text-2xl">🛠</span> {h.previewProjects}
          </h3>
          <div className="space-y-4">
            {projects.map((project) => (
              <div key={project.id}>
                <div className="flex items-baseline justify-between gap-4">
                  <span className="font-bold text-base text-slate-800">{project.name}</span>
                  {project.url?.trim() && (
                    <a href={webHref(project.url)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-xs text-slate-500 hover:text-indigo-600 shrink-0">
                      <Link2 className="w-3 h-3 text-blue-500" /> {displayUrl(project.url)}
                    </a>
                  )}
                </div>
                {getLangText(project.description, lang) && (
                  <div className="text-sm text-slate-600 whitespace-pre-line">{getLangText(project.description, lang)}</div>
                )}
                {project.techStack && (
                  <div className="text-xs text-slate-500 italic mt-1">{project.techStack}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* EDUCATION (certifications, then degrees) */}
      <div className="mb-8">
        <h3 className="text-xl font-bold text-indigo-800 border-b-2 border-indigo-800 mb-4 flex items-center gap-2">
          <span className="text-2xl">🎓</span> {h.previewEducation}
        </h3>
        <div className="space-y-4">
          {certifications.map((cert) => (
            <div key={cert.id} className="flex flex-col sm:flex-row">
              <div className="w-full sm:w-40 flex flex-col items-end pr-4 mb-2 sm:mb-0">
                <span className="font-bold text-slate-800 text-sm">{cert.year}</span>
              </div>
              <div className="flex-1 border-l-2 border-slate-200 pl-4">
                <div className="font-bold text-base text-slate-800">
                  {getLangText(cert.title, lang)}
                </div>
                <div className="text-sm text-slate-600 italic">
                  {cert.issuer}
                </div>
              </div>
            </div>
          ))}
          {education.map((edu) => (
            <div key={edu.id} className="flex flex-col sm:flex-row">
              <div className="w-full sm:w-40 flex flex-col items-end pr-4 mb-2 sm:mb-0">
                <span className="font-bold text-slate-800 text-sm">{edu.year}</span>
              </div>
              <div className="flex-1 border-l-2 border-slate-200 pl-4">
                <div className="font-bold text-base text-slate-800">
                  {getLangText(edu.degree, lang)}
                </div>
                <div className="text-sm text-slate-600 italic mb-1">
                  {edu.school}, {edu.location}
                </div>
                <div className="text-sm text-slate-500">
                  {getLangText(edu.description, lang)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* LANGUAGES */}
      <div className="mb-8">
        <h3 className="text-xl font-bold text-indigo-800 border-b-2 border-indigo-800 mb-4 flex items-center gap-2">
          <span className="text-2xl">🌐</span> {h.previewLanguages}
        </h3>
        <ul className="list-disc list-outside ml-4 mt-2 text-sm text-slate-600 space-y-1">
          {getLangArray(languages, lang).map((l, idx) => (
            <li key={idx}>{l}</li>
          ))}
        </ul>
      </div>

      {/* FOOTER */}
      <div className="mt-auto pt-8 flex justify-between text-xs text-slate-400 border-t border-slate-100">
        <span>{new Date().toLocaleDateString(locale)}</span>
        <span>{personalInfo.firstName} {personalInfo.lastName} - CV</span>
        <span>1/1</span>
      </div>

    </div>
  );
};

export default Preview;

