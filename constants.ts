import { CVData } from './types';

export const INITIAL_CV_DATA: CVData = {
  currentLanguage: 'fr',
  personalInfo: {
    firstName: "Christophe",
    lastName: "ROGER",
    title: {
      fr: "Architecte Logiciel | Développeur/Concepteur Java/JEE",
      en: "Software Architect | Java/JEE Developer/Designer"
    },
    email: "christophe.roger@mail.com",
    medium: "medium.com/@christopheroger",
    location: "2 Rue du quartier, 98765 Ville, Pays",
    linkedin: "linkedin.com/in/christopheroger",
    github: "github.com/darwiin",
    photo: "https://picsum.photos/200/200",
    summary: {
      fr: "Développeur et concepteur JEE depuis plusieurs années, j'ai également une expérience de développement sur l'ensemble de l'écosystème Java (Android, J2ME sur PDA et Javacard sur chipset NFC). J'occupe aujourd'hui un poste d'architecte logiciel et reste passionné par mon métier et par les nouvelles technologies en général.",
      en: "JEE developer and designer for several years, I also have experience developing across the entire Java ecosystem (Android, J2ME on PDA, and Javacard on NFC chipset). Today I hold a software architect position and remain passionate about my profession and new technologies in general."
    }
  },
  skills: [
    {
      id: "1",
      name: {
        fr: "Programmation",
        en: "Programming"
      },
      items: {
        fr: "Java (JEE, JSE, JME, Java Card Platform), Microsoft .Net (C#), Typescript, Javascript, CSS",
        en: "Java (JEE, JSE, JME, Java Card Platform), Microsoft .Net (C#), Typescript, Javascript, CSS"
      }
    },
    {
      id: "2",
      name: {
        fr: "Frameworks",
        en: "Frameworks"
      },
      items: {
        fr: "Spring, Spring Boot, Ionic 3, Angular 2, Angular 4, ZK, JBoss RichFaces",
        en: "Spring, Spring Boot, Ionic 3, Angular 2, Angular 4, ZK, JBoss RichFaces"
      }
    },
    {
      id: "3",
      name: {
        fr: "Bases de données",
        en: "Databases"
      },
      items: {
        fr: "IBM DB2, Oracle Database, Microsoft SQL Server, MySQL, PostgreSQL",
        en: "IBM DB2, Oracle Database, Microsoft SQL Server, MySQL, PostgreSQL"
      }
    },
    {
      id: "4",
      name: {
        fr: "Outils",
        en: "Tools"
      },
      items: {
        fr: "IntelliJ Idea, Eclipse, Visual Studio Code, Maven, Ant, SVN, git",
        en: "IntelliJ Idea, Eclipse, Visual Studio Code, Maven, Ant, SVN, git"
      }
    }
  ],
  experience: [
    {
      id: "exp1",
      role: {
        fr: "Architecte logiciel | Développeur/Concepteur Senior JEE",
        en: "Software Architect | Senior JEE Developer/Designer"
      },
      company: "EPI",
      location: "Nouvelle-Calédonie",
      startDate: {
        fr: "Décembre 2015",
        en: "December 2015"
      },
      endDate: {
        fr: "Aujourd'hui",
        en: "Today"
      },
      description: {
        fr: [
          "Reconstruction de la plateforme d'intégration",
          "Migration de l'ensemble des projets Java sous Maven",
          "Evolutions et corrections des bugs du framework de développement interne",
          "Veille technologique"
        ],
        en: [
          "Reconstruction of the integration platform",
          "Migration of all Java projects to Maven",
          "Evolutions and bug fixes of the internal development framework",
          "Technological watch"
        ]
      },
      techStack: "Apache Tomcat, IntelliJ Idea, Eclipse, Maven, Spring Boot, Jenkins, Nexus"
    },
    {
      id: "exp2",
      role: {
        fr: "Architecte logiciel | Développeur/Concepteur Senior JEE",
        en: "Software Architect | Senior JEE Developer/Designer"
      },
      company: "CAFAT",
      location: "Nouvelle-Calédonie",
      startDate: {
        fr: "Avril 2014",
        en: "April 2014"
      },
      endDate: {
        fr: "Novembre 2015",
        en: "November 2015"
      },
      description: {
        fr: [
          "Support et encadrement technique des équipes de développement",
          "Suivi, validation et intégration des développements externalisés",
          "Implémentation, analyse et livraison de correctifs de bugs sur les applicatifs métiers"
        ],
        en: [
          "Technical support and mentoring of development teams",
          "Monitoring, validation and integration of outsourced developments",
          "Implementation, analysis and delivery of bug fixes on business internal applications"
        ]
      },
      techStack: "JBoss EAP, IntelliJ Idea, Eclipse, Maven"
    }
  ],
  education: [
    {
      id: "edu1",
      degree: {
        fr: "Master 2 Informatique",
        en: "Master's Degree in Computer Science"
      },
      school: "Université de Bordeaux",
      location: "France",
      year: "2008",
      description: {
        fr: "Spécialité Génie Logiciel",
        en: "Software Engineering Specialization"
      }
    }
  ],
  certifications: [
    {
      id: "cert1",
      title: {
        fr: "AWS Certified Solutions Architect",
        en: "AWS Certified Solutions Architect"
      },
      issuer: "Amazon Web Services",
      year: "2022"
    }
  ],
  languages: {
    fr: ["Français (Langue maternelle)", "Anglais (Courant)"],
    en: ["French (Native)", "English (Fluent)"]
  }
};

