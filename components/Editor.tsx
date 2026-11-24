import React, { ChangeEvent, useState } from 'react';
import { CVData, ExperienceItem, SkillCategory, EducationItem, CertificationItem, ProjectItem } from '../types';
import {
  getLangText, getLangArray,
  createMultiLangString, createMultiLangArray,
  UI_TRANSLATIONS,
} from '../lib/i18n';
import { Plus, Trash2, ChevronDown, ChevronUp, Upload, ArrowUp, ArrowDown } from 'lucide-react';
import { moveItem } from '../lib/arrayUtils';

interface EditorProps {
  data: CVData;
  onChange: (newData: CVData) => void;
}

const Editor: React.FC<EditorProps> = ({ data, onChange }) => {
  const [activeSection, setActiveSection] = useState<string | null>('personal');
  const lang = data.currentLanguage;
  const t = UI_TRANSLATIONS[lang] ?? UI_TRANSLATIONS['fr'];

  const updatePersonal = (field: keyof CVData['personalInfo'], value: string) => {
    const personalInfo = { ...data.personalInfo };
    if (field === 'title' || field === 'availability' || field === 'summary') {
      personalInfo[field] = { ...personalInfo[field], [lang]: value };
    } else {
      (personalInfo as any)[field] = value;
    }
    onChange({ ...data, personalInfo });
  };

  const handlePhotoUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        onChange({
          ...data,
          personalInfo: { ...data.personalInfo, photo: reader.result as string }
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const updateSkill = (index: number, field: keyof SkillCategory, value: string) => {
    const newSkills = [...data.skills];
    if (field === 'name' || field === 'items') {
      newSkills[index] = {
        ...newSkills[index],
        [field]: { ...newSkills[index][field], [lang]: value }
      };
    }
    onChange({ ...data, skills: newSkills });
  };

  const addSkill = () => {
    onChange({
      ...data,
      skills: [
        ...data.skills,
        {
          id: Date.now().toString(),
          name: createMultiLangString({ fr: 'Nouvelle Catégorie', en: 'New Category' }),
          items: createMultiLangString(),
        }
      ]
    });
  };

  const removeSkill = (index: number) => {
    onChange({ ...data, skills: data.skills.filter((_, i) => i !== index) });
  };

  const updateExperience = (index: number, field: keyof ExperienceItem, value: any) => {
    const newExp = [...data.experience];
    if (field === 'role' || field === 'startDate' || field === 'endDate') {
      newExp[index] = {
        ...newExp[index],
        [field]: { ...newExp[index][field], [lang]: value }
      };
    } else {
      (newExp[index] as any)[field] = value;
    }
    onChange({ ...data, experience: newExp });
  };

  const updateExperienceDesc = (expIndex: number, descIndex: number, value: string) => {
    const newExp = [...data.experience];
    const currentDescs = [...getLangArray(newExp[expIndex].description, lang)];
    currentDescs[descIndex] = value;
    newExp[expIndex].description = { ...newExp[expIndex].description, [lang]: currentDescs };
    onChange({ ...data, experience: newExp });
  };

  const addExperienceDesc = (expIndex: number) => {
    const newExp = [...data.experience];
    const currentDescs = [...getLangArray(newExp[expIndex].description, lang)];
    currentDescs.push(t.newTask);
    newExp[expIndex].description = { ...newExp[expIndex].description, [lang]: currentDescs };
    onChange({ ...data, experience: newExp });
  };

  // Reorders bullets in the current language only, like add/remove: FR and EN
  // bullet lists are independent and may not have the same length.
  const moveExperienceDesc = (expIndex: number, descIndex: number, offset: -1 | 1) => {
    const newExp = [...data.experience];
    const exp = newExp[expIndex];
    newExp[expIndex] = {
      ...exp,
      description: {
        ...exp.description,
        [lang]: moveItem(getLangArray(exp.description, lang), descIndex, descIndex + offset),
      },
    };
    onChange({ ...data, experience: newExp });
  };

  const removeExperienceDesc = (expIndex: number, descIndex: number) => {
    const newExp = [...data.experience];
    newExp[expIndex].description = {
      ...newExp[expIndex].description,
      [lang]: getLangArray(newExp[expIndex].description, lang).filter((_, i) => i !== descIndex)
    };
    onChange({ ...data, experience: newExp });
  };

  const addExperience = () => {
    onChange({
      ...data,
      experience: [{
        id: Date.now().toString(),
        role: createMultiLangString({ fr: 'Nouveau Poste', en: 'New Role' }),
        company: 'Company',
        location: 'Location',
        startDate: createMultiLangString({ fr: 'Début', en: 'Start' }),
        endDate: createMultiLangString({ fr: 'Fin', en: 'End' }),
        description: createMultiLangArray({ fr: ['Description de la mission'], en: ['Task description'] }),
        techStack: ''
      }, ...data.experience]
    });
  };

  const removeExperience = (index: number) => {
    onChange({ ...data, experience: data.experience.filter((_, i) => i !== index) });
  };

  const updateEducation = (index: number, field: keyof EducationItem, value: string) => {
    const newEdu = [...data.education];
    if (field === 'degree' || field === 'description') {
      newEdu[index] = {
        ...newEdu[index],
        [field]: { ...newEdu[index][field], [lang]: value }
      };
    } else {
      (newEdu[index] as any)[field] = value;
    }
    onChange({ ...data, education: newEdu });
  };

  const addEducation = () => {
    onChange({
      ...data,
      education: [...data.education, {
        id: Date.now().toString(),
        school: 'University',
        degree: createMultiLangString({ fr: 'Diplôme', en: 'Degree' }),
        location: 'City',
        year: '2022',
        description: createMultiLangString({ fr: 'Description', en: 'Description' }),
      }]
    });
  };

  const removeEducation = (index: number) => {
    onChange({ ...data, education: data.education.filter((_, i) => i !== index) });
  };

  const updateCertification = (index: number, field: keyof CertificationItem, value: string) => {
    const newCerts = [...data.certifications];
    if (field === 'title') {
      newCerts[index] = {
        ...newCerts[index],
        title: { ...newCerts[index].title, [lang]: value }
      };
    } else {
      (newCerts[index] as any)[field] = value;
    }
    onChange({ ...data, certifications: newCerts });
  };

  const addCertification = () => {
    onChange({
      ...data,
      certifications: [...data.certifications, {
        id: Date.now().toString(),
        title: createMultiLangString({ fr: 'Titre de la certification', en: 'Certification title' }),
        issuer: 'Organisme',
        year: new Date().getFullYear().toString(),
      }]
    });
  };

  const removeCertification = (index: number) => {
    onChange({ ...data, certifications: data.certifications.filter((_, i) => i !== index) });
  };

  const projects = data.projects ?? [];

  const updateProject = (index: number, field: keyof Omit<ProjectItem, 'id'>, value: string) => {
    const newProjects = [...projects];
    newProjects[index] = field === 'description'
      ? { ...newProjects[index], description: { ...newProjects[index].description, [lang]: value } }
      : { ...newProjects[index], [field]: value };
    onChange({ ...data, projects: newProjects });
  };

  const addProject = () => {
    onChange({
      ...data,
      projects: [...projects, {
        id: Date.now().toString(),
        name: '',
        description: createMultiLangString({ fr: '', en: '' }),
        techStack: '',
      }]
    });
  };

  const removeProject = (index: number) => {
    onChange({ ...data, projects: projects.filter((_, i) => i !== index) });
  };

  const updateLanguageItem = (index: number, value: string) => {
    const newLangs = [...getLangArray(data.languages, lang)];
    newLangs[index] = value;
    onChange({ ...data, languages: { ...data.languages, [lang]: newLangs } });
  };

  const addLanguageItem = () => {
    const newLangs = [...getLangArray(data.languages, lang)];
    newLangs.push(t.newLanguageItem);
    onChange({ ...data, languages: { ...data.languages, [lang]: newLangs } });
  };

  const removeLanguageItem = (index: number) => {
    onChange({
      ...data,
      languages: {
        ...data.languages,
        [lang]: getLangArray(data.languages, lang).filter((_, i) => i !== index)
      }
    });
  };

  const SectionHeader = ({ title, id }: { title: string; id: string }) => (
    <button
      onClick={() => setActiveSection(activeSection === id ? null : id)}
      data-testid={`section-header-${id}`}
      className="w-full flex justify-between items-center p-4 bg-slate-50 hover:bg-slate-100 border-b border-slate-200 transition-colors"
    >
      <span className="font-semibold text-slate-700">{title}</span>
      {activeSection === id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
  );

  return (
    <div className="bg-white shadow-lg rounded-lg overflow-hidden h-full flex flex-col">
      <div className="flex-1 overflow-y-auto">

        {/* Personal Info */}
        <SectionHeader title={t.personalInfo} id="personal" />
        {activeSection === 'personal' && (
          <div className="p-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">{t.firstName}</label>
                <input
                  type="text"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  value={data.personalInfo.firstName}
                  onChange={(e) => updatePersonal('firstName', e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500">{t.lastName}</label>
                <input
                  type="text"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                  value={data.personalInfo.lastName}
                  onChange={(e) => updatePersonal('lastName', e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t.jobTitle}</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                value={getLangText(data.personalInfo.title, lang)}
                onChange={(e) => updatePersonal('title', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t.availabilityLabel}</label>
              <input
                type="text"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                value={getLangText(data.personalInfo.availability, lang)}
                onChange={(e) => updatePersonal('availability', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t.changePhoto}</label>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 cursor-pointer bg-slate-50 hover:bg-slate-100 px-3 py-2 rounded-lg border border-slate-200 transition-colors text-sm font-medium text-slate-600">
                  <Upload className="w-4 h-4" />
                  <span>{t.changePhoto}</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                </label>
                {data.personalInfo.photo && (
                  <span className="text-xs text-emerald-600 font-medium">{t.photoLoaded}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500">{t.professionalSummary}</label>
              <textarea
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm h-24 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none transition-shadow"
                value={getLangText(data.personalInfo.summary, lang)}
                onChange={(e) => updatePersonal('summary', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              {([
                { label: 'Email', field: 'email', type: 'email', value: data.personalInfo.email },
                { label: t.phoneLabel, field: 'phone', type: 'tel', value: data.personalInfo.phone ?? '' },
                { label: t.address, field: 'location', type: 'text', value: data.personalInfo.location },
                { label: 'LinkedIn', field: 'linkedin', type: 'text', value: data.personalInfo.linkedin },
                { label: 'GitHub', field: 'github', type: 'text', value: data.personalInfo.github },
                { label: 'Medium', field: 'medium', type: 'url', value: data.personalInfo.medium },
              ] as const).map(({ label, field, type, value }) => (
                <div key={field} className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-500">{label}</label>
                  <input
                    type={type}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
                    value={value}
                    onChange={(e) => updatePersonal(field, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        <SectionHeader title={t.skillsSection} id="skills" />
        {activeSection === 'skills' && (
          <div className="p-4 space-y-4">
            {data.skills.map((skill, index) => (
              <div key={skill.id} className="border p-3 rounded bg-slate-50 relative group">
                <button
                  onClick={() => removeSkill(index)}
                  className="absolute top-2 right-2 text-red-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <input
                  className="font-bold bg-transparent border-b border-slate-300 w-full mb-2 focus:outline-none focus:border-indigo-500"
                  value={getLangText(skill.name, lang)}
                  onChange={(e) => updateSkill(index, 'name', e.target.value)}
                  placeholder={t.categoryPlaceholder}
                />
                <textarea
                  className="w-full border p-2 rounded text-sm"
                  value={getLangText(skill.items, lang)}
                  onChange={(e) => updateSkill(index, 'items', e.target.value)}
                  placeholder={t.skillsListPlaceholder}
                  data-testid={`skill-items-${index}`}
                />
              </div>
            ))}
            <button onClick={addSkill} className="w-full py-2 flex justify-center items-center gap-2 border-2 border-dashed border-slate-300 rounded text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-colors">
              <Plus className="w-4 h-4" /> {t.addCategory}
            </button>
          </div>
        )}

        {/* Experience */}
        <SectionHeader title={t.experienceSection} id="experience" />
        {activeSection === 'experience' && (
          <div className="p-4 space-y-6">
            <button onClick={addExperience} className="w-full py-2 bg-indigo-50 text-indigo-700 rounded font-medium hover:bg-indigo-100 transition-colors mb-4">
              + {t.addExperience}
            </button>
            {data.experience.map((exp, index) => (
              <div key={exp.id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-slate-700">{t.experienceLabel} #{index + 1}</h4>
                  <button onClick={() => removeExperience(index)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>

                <div className="grid grid-cols-2 gap-3 mb-3">
                  <input className="border p-2 rounded text-sm" placeholder={t.roleLabel} value={getLangText(exp.role, lang)} onChange={(e) => updateExperience(index, 'role', e.target.value)} />
                  <input className="border p-2 rounded text-sm" placeholder={t.companyLabel} value={exp.company} onChange={(e) => updateExperience(index, 'company', e.target.value)} />
                  <input className="border p-2 rounded text-sm" placeholder={t.startDateLabel} value={getLangText(exp.startDate, lang)} onChange={(e) => updateExperience(index, 'startDate', e.target.value)} />
                  <input className="border p-2 rounded text-sm" placeholder={t.endDateLabel} value={getLangText(exp.endDate, lang)} onChange={(e) => updateExperience(index, 'endDate', e.target.value)} />
                  <input className="border p-2 rounded text-sm col-span-2" placeholder={t.locationLabel} value={exp.location} onChange={(e) => updateExperience(index, 'location', e.target.value)} />
                </div>

                <div className="space-y-2 mb-3">
                  <label className="text-xs font-semibold text-slate-500 uppercase">{t.responsibilitiesLabel} (Bullet points — *texte* = gras)</label>
                  {getLangArray(exp.description, lang).map((desc, dIndex, descs) => (
                    <div key={dIndex} className="flex gap-2 items-center" data-testid={`exp-${index}-bullet-${dIndex}`}>
                      <input
                        className="flex-1 border p-1 rounded text-sm"
                        value={desc}
                        onChange={(e) => updateExperienceDesc(index, dIndex, e.target.value)}
                      />
                      <button
                        onClick={() => moveExperienceDesc(index, dIndex, -1)}
                        disabled={dIndex === 0}
                        aria-label={t.moveUp}
                        title={t.moveUp}
                        className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400"
                      >
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => moveExperienceDesc(index, dIndex, 1)}
                        disabled={dIndex === descs.length - 1}
                        aria-label={t.moveDown}
                        title={t.moveDown}
                        className="text-slate-400 hover:text-indigo-600 disabled:opacity-30 disabled:hover:text-slate-400"
                      >
                        <ArrowDown className="w-3 h-3" />
                      </button>
                      <button onClick={() => removeExperienceDesc(index, dIndex)} className="text-slate-400 hover:text-red-500">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => addExperienceDesc(index)} className="text-xs text-indigo-600 hover:underline">+ {t.addLine}</button>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase">Tech Stack ({t.commaSeparated})</label>
                  <input
                    className="w-full border p-2 rounded text-sm"
                    value={exp.techStack}
                    onChange={(e) => updateExperience(index, 'techStack', e.target.value)}
                    placeholder="Java, React, SQL..."
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Personal projects */}
        <SectionHeader title={t.projectsSection} id="projects" />
        {activeSection === 'projects' && (
          <div className="p-4 space-y-6">
            <button onClick={addProject} data-testid="add-project-button" className="w-full py-2 bg-indigo-50 text-indigo-700 rounded font-medium hover:bg-indigo-100 transition-colors mb-4">
              + {t.addProject}
            </button>
            {projects.map((project, index) => (
              <div key={project.id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm" data-testid={`project-${index}`}>
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-slate-700">{t.projectLabel} #{index + 1}</h4>
                  <button onClick={() => removeProject(index)} aria-label="Delete project" className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <input className="border p-2 rounded text-sm" placeholder={t.projectNameLabel} value={project.name} onChange={(e) => updateProject(index, 'name', e.target.value)} />
                  <input className="border p-2 rounded text-sm" placeholder={t.projectUrlLabel} value={project.url ?? ''} onChange={(e) => updateProject(index, 'url', e.target.value)} />
                  <textarea className="w-full border p-2 rounded text-sm" placeholder="Description" value={getLangText(project.description, lang)} onChange={(e) => updateProject(index, 'description', e.target.value)} />
                  <div>
                    <label className="text-xs font-semibold text-slate-500 uppercase">Tech Stack ({t.commaSeparated})</label>
                    <input className="w-full border p-2 rounded text-sm" placeholder="TypeScript, React, Node.js..." value={project.techStack} onChange={(e) => updateProject(index, 'techStack', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Education */}
        <SectionHeader title={t.educationSection} id="education" />
        {activeSection === 'education' && (
          <div className="p-4 space-y-6">
            <button onClick={addEducation} className="w-full py-2 bg-indigo-50 text-indigo-700 rounded font-medium hover:bg-indigo-100 transition-colors mb-4">
              + {t.addEducation}
            </button>
            {data.education.map((edu, index) => (
              <div key={edu.id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-slate-700">{t.educationLabel} #{index + 1}</h4>
                  <button onClick={() => removeEducation(index)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <input className="border p-2 rounded text-sm" placeholder={t.degreeLabel} value={getLangText(edu.degree, lang)} onChange={(e) => updateEducation(index, 'degree', e.target.value)} />
                  <input className="border p-2 rounded text-sm" placeholder={t.schoolLabel} value={edu.school} onChange={(e) => updateEducation(index, 'school', e.target.value)} />
                  <div className="grid grid-cols-2 gap-3">
                    <input className="border p-2 rounded text-sm" placeholder={t.yearLabel} value={edu.year} onChange={(e) => updateEducation(index, 'year', e.target.value)} />
                    <input className="border p-2 rounded text-sm" placeholder={t.locationLabel} value={edu.location} onChange={(e) => updateEducation(index, 'location', e.target.value)} />
                  </div>
                  <textarea className="w-full border p-2 rounded text-sm" placeholder="Description" value={getLangText(edu.description, lang)} onChange={(e) => updateEducation(index, 'description', e.target.value)} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Certifications */}
        <SectionHeader title={t.certificationsSection} id="certifications" />
        {activeSection === 'certifications' && (
          <div className="p-4 space-y-6">
            <button onClick={addCertification} className="w-full py-2 bg-indigo-50 text-indigo-700 rounded font-medium hover:bg-indigo-100 transition-colors mb-4">
              + {t.addCertification}
            </button>
            {data.certifications.map((cert, index) => (
              <div key={cert.id} className="border border-slate-200 rounded-lg p-4 bg-white shadow-sm">
                <div className="flex justify-between items-start mb-4">
                  <h4 className="font-bold text-slate-700">{t.certificationLabel} #{index + 1}</h4>
                  <button onClick={() => removeCertification(index)} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <input className="border p-2 rounded text-sm" placeholder={t.certificationTitleLabel} value={getLangText(cert.title, lang)} onChange={(e) => updateCertification(index, 'title', e.target.value)} />
                  <div className="grid grid-cols-2 gap-3">
                    <input className="border p-2 rounded text-sm" placeholder={t.issuerLabel} value={cert.issuer} onChange={(e) => updateCertification(index, 'issuer', e.target.value)} />
                    <input className="border p-2 rounded text-sm" placeholder={t.yearLabel} value={cert.year} onChange={(e) => updateCertification(index, 'year', e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Languages */}
        <SectionHeader title={t.languagesSection} id="languages" />
        {activeSection === 'languages' && (
          <div className="p-4 space-y-4">
            {getLangArray(data.languages, lang).map((l, index) => (
              <div key={index} className="flex gap-2">
                <input
                  className="flex-1 border p-2 rounded text-sm"
                  value={l}
                  onChange={(e) => updateLanguageItem(index, e.target.value)}
                  placeholder={t.languagePlaceholder}
                />
                <button onClick={() => removeLanguageItem(index)} className="text-red-400 hover:text-red-600">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button onClick={addLanguageItem} className="w-full py-2 flex justify-center items-center gap-2 border-2 border-dashed border-slate-300 rounded text-slate-500 hover:bg-slate-50 hover:text-indigo-600 transition-colors">
              <Plus className="w-4 h-4" /> {t.addLanguage}
            </button>
          </div>
        )}

      </div>
    </div>
  );
};

export default Editor;
