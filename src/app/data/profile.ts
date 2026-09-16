export interface Experience {
  readonly company: string;
  readonly companyUrl?: string;
  readonly title: string;
  readonly dates: string;
  readonly location?: string;
  readonly summary: string;
  readonly summaryPrefix?: string;
  readonly summarySuffix?: string;
  readonly projects?: readonly ProjectLink[];
  readonly achievements: readonly Achievement[];
  readonly technologies: readonly string[];
}

export interface Achievement {
  readonly highlight: string;
  readonly detail: string;
}

export interface ProjectLink {
  readonly name: string;
  readonly url: string;
}

export interface Education {
  readonly qualification: string;
  readonly institution: string;
  readonly dates: string;
}

export const contact = {
  email: 'novahoangdev@gmail.com',
  phoneDisplay: '(+84) 328 369 788',
  phoneHref: '+84328369788',
  linkedIn: 'https://www.linkedin.com/in/novahoangdev/',
  linkedInDisplay: 'linkedin.com/in/novahoangdev',
  github: 'https://github.com/novahoangdev',
  githubDisplay: 'github.com/novahoangdev',
  x: 'https://x.com/novahoangdev',
  xDisplay: 'x.com/novahoangdev',
  website: 'https://novahoangdev.web.app/',
  websiteDisplay: 'novahoangdev.web.app',
  whatsApp: 'https://wa.me/84328369788',
  whatsAppDisplay: '(+84) 328 369 788',
  location: 'Ho Chi Minh City, Vietnam',
} as const;

export const profile = {
  vietnameseName: 'Hoàng Văn Hòa',
  englishName: 'Nova Hoang',
  internationalName: 'Nova Hoang (Hoang Van Hoa)',
  title: 'Senior Software Engineer',
  headline: 'Senior Frontend Developer · Angular & React · Enterprise UI',
  summary:
    'Senior Software Engineer with over seven years of experience building high-performance, enterprise-grade web applications. I connect robust technical architecture with thoughtful user experiences, with deep expertise in Angular, TypeScript, React, and Node.js ecosystems.',
  leadership:
    'Beyond hands-on engineering and architecture, I actively drive project delivery strategies, streamline engineering workflows, and mentor engineers to build high-performing teams and scalable digital products.',
  internationalStatus:
    'Based in Vietnam · Open to international relocation, remote & hybrid · Visa sponsorship welcome',
} as const;

export const skillGroups = [
  {
    label: 'Frontend',
    skills: [
      'Angular',
      'ReactJS',
      'TypeScript',
      'RxJS',
      'Tailwind CSS',
      'SCSS',
      'Kendo UI',
      'Ant Design',
      'Bootstrap',
      'Element UI',
    ],
  },
  {
    label: 'Backend & Data',
    skills: ['Node.js', 'NestJS', 'Microservices', 'Redis', 'PostgreSQL', 'REST APIs', 'GraphQL'],
  },
  {
    label: 'Architecture',
    skills: [
      'Microservices Architecture',
      'Enterprise UI',
      'Performance & Core Web Vitals',
      'Design Systems',
      'Engineering Process Optimization',
      'Technical Mentorship',
    ],
  },
  {
    label: 'Design',
    skills: ['Figma', 'Adobe XD', 'Photoshop', 'Illustrator', 'Premiere Pro'],
  },
] as const;

export const experiences: readonly Experience[] = [
  {
    company: 'SJ Group',
    companyUrl: 'https://www.sjgroup.com/',
    title: 'Senior Software Engineer',
    dates: 'May 2024 — Present',
    summary:
      'Architect backend microservices and modern Angular/Kendo UI enterprise portals for Temasek Polytechnic and Changi Airport Group, powering multi-tenant facility operations, digital asset tracking, procurement governance, and real-time incident workflows.',
    summaryPrefix: 'Architect enterprise Angular/Kendo UI portals and backend services for',
    summarySuffix:
      ', powering multi-tenant facility management, campus operations, fault dispatch, and procurement workflows.',
    projects: [
      { name: 'Temasek Polytechnic', url: 'https://www.tp.edu.sg/' },
      {
        name: 'Changi Airport Group',
        url: 'https://www.changiairport.com/en/corporate.html',
      },
    ],
    achievements: [
      {
        highlight: 'Core Operations & Microservices Delivery:',
        detail:
          ' Decoupled mission-critical enterprise modules—Asset Management, Fault Reporting, Smart Facility Booking, Procurement, and Campus Inspection—into modular NestJS microservices; integrated FCM for auxiliary mobile push notifications and orchestrated 24+ zero-downtime releases via Bitbucket CI/CD.',
      },
      {
        highlight: '230M+ Record Audit Pipeline & Export Engine:',
        detail:
          ' Engineered a resilient data export pipeline for enterprise client auditing across 230M+ raw records (229M+ IoT telemetry, 787K+ bookings, 71K+ faults); overcame Excel’s 1.04M row/sheet hard limit via streaming chunk partitioning, dynamic attachment metadata correlation, and portal-identical formatting with zero memory overflow.',
      },
      {
        highlight: '70% Latency Reduction & Redis Caching Layer:',
        detail:
          ' Implemented multi-tiered Redis caching (distributed locks for high-concurrency facility bookings, query cache, session store) and PostgreSQL query indexing, slashing database response latency by 70% under peak airport operational traffic.',
      },
      {
        highlight: 'Design System & Enterprise UI Architecture:',
        detail:
          ' Standardized reusable Angular and Kendo UI component libraries with strict TypeScript contracts, responsive state management, and unified UX patterns, elevating delivery velocity across a 7-engineer cross-functional squad.',
      },
    ],
    technologies: [
      'Angular',
      'TypeScript',
      'NestJS',
      'Microservices',
      'Redis',
      'PostgreSQL',
      'FCM',
      'Kendo UI',
      'Docker',
      'RxJS',
    ],
  },
  {
    company: 'WATA Corp',
    companyUrl: 'https://watacorp.com/',
    title: 'Software Engineer',
    dates: 'Nov 2021 — Apr 2024',
    summary:
      'Engineered and scaled enterprise web and e-commerce platforms including PoolZoom and The Mentor Method for US and international clients, driving high-conversion e-commerce scale, UI architecture, and AI-powered integrations.',
    summaryPrefix: 'Engineered and scaled enterprise web & e-commerce platforms including',
    summarySuffix: ' for international enterprise clients.',
    projects: [
      { name: 'PoolZoom', url: 'https://www.poolzoom.com/' },
      { name: 'The Mentor Method', url: 'https://www.thementormethod.com/' },
    ],
    achievements: [
      {
        highlight: 'High-Converting E-Commerce Storefront (PoolZoom):',
        detail:
          ' Engineered the storefront UI using Vue.js and Nuxt.js, implementing strict design system fidelity, Core Web Vitals optimization, and technical SEO for swimming pool equipment and parts.',
      },
      {
        highlight: 'Cloudinary Image Pipeline & UX Optimization (PoolZoom):',
        detail:
          ' Integrated Cloudinary for dynamic image transformations, responsive delivery, and format compression, drastically accelerating catalog browsing and optimizing overall user experience for 200,000+ customers.',
      },
      {
        highlight: 'Mentorship & Training Architecture (The Mentor Method):',
        detail:
          ' Architected modular curriculum frameworks, customizable roadmap templates, and skill-training libraries for mentors and mentees using Angular, Tailwind CSS, and GraphQL.',
      },
      {
        highlight: 'Real-Time Session Transcription (The Mentor Method):',
        detail:
          ' Integrated Google Speech-to-Text for live session transcription, automated notes generation, and comprehensive progress evaluation reports to enrich the mentorship experience.',
      },
    ],
    technologies: [
      'Angular',
      'Vue',
      'Nuxt',
      'TypeScript',
      'GraphQL',
      'Tailwind CSS',
      'Cloudinary',
      'Google Speech-to-Text',
      'REST APIs',
    ],
  },
  {
    company: 'Gumi Vietnam Co., Ltd.',
    companyUrl: 'https://gumiviet.com/',
    title: 'Software Engineer',
    dates: 'Dec 2019 — Nov 2021',
    summary:
      'Architected and delivered multi-tenant media publishing platforms, cognitive health gamification portals, and enterprise career ecosystems for leading Japanese enterprises including Nikkan Sports, AXA Direct Life, and Tsukuba University.',
    summaryPrefix:
      'Architected multi-tenant media CMS, health tech gamification, and corporate career platforms for major Japanese enterprises including',
    summarySuffix: ', and Ajinomoto.',
    projects: [
      { name: 'Nikkan Sports', url: 'https://www.nikkansports.com/' },
      { name: 'AXA Direct Life', url: 'https://www.axa-direct-life.co.jp/' },
      {
        name: 'Gumi Career Support',
        url: 'https://shuukatsu-jumpstart.cegloc.tsukuba.ac.jp/students/sign-in',
      },
      { name: 'Campus Career', url: 'https://campuscareer.com/' },
    ],
    achievements: [
      {
        highlight: 'Project Scaffolding & Multi-Tenant Media CMS (Nikkan Sports):',
        detail:
          ' Initialized project architecture from scratch for a high-traffic Japanese sports news publishing system; engineered dynamic sub-domain rendering, dynamic form generators per sub-company, custom WYSIWYG article editors with drag-and-drop layouts, and granular RBAC workflows.',
      },
      {
        highlight: 'Cognitive Brain-Training Gamification (AXA Direct Life & Active Brain CLUB):',
        detail:
          ' Integrated interactive daily cognitive mini-games (Notore) into AXA\'s digital customer care ecosystem ("Emma by AXA"), targeting 6 core cognitive functions (memory, focus, speed, inhibition) for middle-aged and senior policyholders via Active Brain CLUB platform connectivity.',
      },
      {
        highlight: 'Enterprise Career & Student Portals (Gumi Career Support & Campus Career):',
        detail:
          ' Built career development and job-hunting portals for Tsukuba University students and Campus Career, featuring responsive interview preparation roadmaps, company matching algorithms, and streamlined recruiter-student communication channels.',
      },
      {
        highlight: 'Internal Corporate Learning Management (Ajinomoto):',
        detail:
          ' Developed internal employee training and onboarding workflows with progress tracking, interactive assessment modules, and offline capability powered by Angular PWA.',
      },
    ],
    technologies: [
      'Angular',
      'React',
      'TypeScript',
      'JavaScript',
      'Firebase',
      'NativeScript',
      'Ant Design',
      'SCSS',
      'REST APIs',
    ],
  },
  {
    company: 'YOONG Vietnam',
    companyUrl: 'https://yoong.vn/en/',
    title: 'Frontend Developer',
    dates: 'Apr 2019 — Nov 2019',
    location: 'Ho Chi Minh City, Vietnam',
    summary:
      'Built responsive user interfaces for corporate web platforms, e-commerce campaigns, and applicant management portals, including Mitsubishi Electric Vietnam and PG Works Vietnam.',
    summaryPrefix:
      'Built responsive user interfaces for corporate campaigns and talent platforms, including',
    summarySuffix: '.',
    projects: [
      {
        name: 'Mitsubishi Electric Vietnam',
        url: 'https://www.mitsubishi-electric.vn/',
      },
      { name: 'PG Works Vietnam', url: 'https://pgworks.vn/' },
    ],
    achievements: [
      {
        highlight: 'Interactive Campaign Showcases:',
        detail:
          ' Developed pixel-perfect, responsive marketing portals and product catalogues for Mitsubishi Electric Vietnam using Vue.js, Nuxt, and modern SCSS.',
      },
      {
        highlight: 'Talent Acquisition Dashboard:',
        detail:
          ' Built applicant tracking and recruitment workflows for PG Works Vietnam using Element UI and Bootstrap, improving candidate form completion rates.',
      },
      {
        highlight: 'Cross-Browser Performance & SEO:',
        detail:
          ' Optimized front-end bundle sizes and implemented SEO best practices, achieving 95+ Google Lighthouse scores across desktop and mobile devices.',
      },
    ],
    technologies: ['Vue', 'Nuxt', 'SCSS', 'Bootstrap', 'Element UI', 'JavaScript'],
  },
];

export const education: readonly Education[] = [
  {
    qualification: 'Information Technology — High Quality Program',
    institution: 'International College Ho Chi Minh City — University of Science',
    dates: '2017 — 2019',
  },
  {
    qualification: 'Python Programming Course',
    institution: 'University of Science Ho Chi Minh City',
    dates: 'Feb 2019 — May 2019',
  },
];
