import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

const contact = {
  email: 'novahoangdev@gmail.com',
  phoneDisplay: '(+84) 328 369 788',
  linkedIn: 'linkedin.com/in/novahoangdev',
  github: 'github.com/novahoangdev',
  website: 'novahoangdev.web.app',
  location: 'Ho Chi Minh City, Vietnam',
};

const profile = {
  vietnameseName: 'Hoang Van Hoa (Nova Hoang)',
  internationalName: 'Nova Hoang (Hoang Van Hoa)',
  headline: 'Senior Frontend Developer · Angular & React · Enterprise UI',
  summary:
    'Senior Software Engineer with over seven years of experience building high-performance, enterprise-grade web applications. Deep expertise in Angular, TypeScript, React, and Node.js ecosystems, connecting robust technical architecture with thoughtful user experiences.',
  leadership:
    'Proven track record in technical leadership, mentoring engineers, driving design systems, and delivering multi-tenant mission-critical systems for global organizations including Changi Airport Group and Temasek Polytechnic.',
  internationalStatus:
    'Based in Vietnam · Open to international relocation, remote & hybrid · Visa sponsorship welcome',
};

const skillGroups = [
  {
    label: 'Frontend',
    skills: 'Angular, ReactJS, TypeScript, RxJS, Tailwind CSS, SCSS, Kendo UI, Ant Design, Bootstrap, Element UI',
  },
  { label: 'Backend & Data', skills: 'Node.js, NestJS, Sails.js, PostgreSQL, REST APIs, GraphQL' },
  { label: 'Architecture', skills: 'Enterprise UI, Design Systems, Performance, Agile/Scrum' },
  { label: 'Design & Tools', skills: 'Figma, Adobe XD, Photoshop, Illustrator, Git, Bitbucket, Jira' },
];

const experiences = [
  {
    company: 'SJ Group',
    dates: 'May 2024 — Present',
    title: 'Senior Software Engineer',
    summary:
      'Architect enterprise Angular/Kendo UI portals and NestJS/Sails.js backend services for Temasek Polytechnic and Changi Airport Group, powering multi-tenant facility management, campus operations, fault dispatch, and procurement workflows.',
    bullets: [
      'Continuous Enterprise Delivery: Spearheaded 24+ production releases across Fault Reporting, Smart Booking, Procurement, and Inspection modules using NestJS, Sails.js, and Bitbucket CI/CD pipelines.',
      '65% Faster Operational Workflows: Implemented high-throughput bulk processing, custom data grids, and automated Excel/PDF report generation for asset licensing, warranty, and space management.',
      '70% Query & Search Latency Reduction: Re-indexed PostgreSQL relational structures and streamlined fault-to-purchase-request linkage, cutting data retrieval times under heavy concurrent loads.',
      'Design System & UI Architecture: Standardized reusable Kendo UI and Angular component libraries, improving frontend delivery velocity across 7 engineering team members.',
    ],
    tech: 'Angular, TypeScript, Kendo UI, NestJS, Sails.js, PostgreSQL, RxJS, Docker',
  },
  {
    company: 'WATA Corp',
    dates: 'Nov 2021 — Apr 2024',
    title: 'Software Engineer',
    summary:
      'Engineered and scaled SaaS web platforms including The Mentor Method, Betterleave, and PoolZoom for US and international enterprise clients, focusing on scalable architecture, real-time APIs, and high conversion UX.',
    bullets: [
      'SaaS Platform Scalability: Developed enterprise mentoring and care navigation portals using React, Angular, and Tailwind CSS, supporting thousands of active concurrent professionals.',
      'Real-time & AI Integrations: Integrated Google Speech-to-Text real-time transcription, GraphQL subscriptions, and secure RESTful endpoints for interactive user sessions.',
      '40% Web Performance Boost: Overhauled PoolZoom e-commerce catalog rendering with route-level code splitting, virtual scrolling, and optimized asset pipelines.',
      'Frontend Architecture & Mentorship: Established strict TypeScript linting, reusable UI design systems with Ant Design, and conducted technical code reviews across multi-disciplinary squads.',
    ],
    tech: 'Angular, React, TypeScript, GraphQL, Tailwind CSS, Ant Design, RxJS, REST APIs',
  },
  {
    company: 'Gumi Vietnam Co., Ltd.',
    dates: 'Dec 2019 — Nov 2021',
    title: 'Software Engineer',
    summary:
      'Delivered full-cycle fintech, CMS, and web applications for premier Japanese enterprise clients including Zoopay, Gumi JP, and Nikkan Sports.',
    bullets: [
      'Fintech Rewards & Payments: Built the Zoopay merchant portal and customer reward platform with Angular and Firebase, enabling seamless QR code redemption and point transaction histories.',
      'High-Traffic Media & CMS: Constructed high-volume publishing interfaces and editorial CMS tooling for Nikkan Sports with sub-second page transitions and responsive web layouts.',
      'Hybrid Mobile Applications: Delivered native mobile experiences using NativeScript, Angular, and React, maintaining unified code sharing between iOS, Android, and web.',
      'Engineering Mentorship: Coordinated technical delivery with Japanese IT communicators and mentored 6+ junior engineers on modern JavaScript and component best practices.',
    ],
    tech: 'Angular, React, JavaScript, Firebase, NativeScript, Ant Design, SCSS',
  },
  {
    company: 'YOONG Vietnam',
    dates: 'Apr 2019 — Nov 2019',
    title: 'Frontend Developer',
    summary:
      'Built responsive user interfaces for corporate campaigns and talent platforms, including Mitsubishi Electric Vietnam and PG Works Vietnam.',
    bullets: [
      'Interactive Campaign Showcases: Developed pixel-perfect, responsive marketing portals and product catalogues for Mitsubishi Electric Vietnam using Vue.js, Nuxt, and modern SCSS.',
      'Talent Acquisition Dashboard: Built applicant tracking and recruitment workflows for PG Works Vietnam using Element UI and Bootstrap, improving candidate form completion rates.',
      'Cross-Browser Performance & SEO: Optimized front-end bundle sizes and implemented SEO best practices, achieving 95+ Google Lighthouse scores across desktop and mobile devices.',
    ],
    tech: 'Vue, Nuxt, SCSS, Bootstrap, Element UI, JavaScript',
  },
];

const education = [
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

function wrapText(text, maxWidth, font, fontSize) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width <= maxWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

async function createVietnamCV() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  // Exact theme colors matching homepage
  const teal = rgb(47 / 255, 126 / 255, 124 / 255); // #2f7e7c
  const tealBright = rgb(120 / 255, 187 / 255, 181 / 255); // #78bbb5
  const darkNavy = rgb(23 / 255, 43 / 255, 54 / 255); // #172b36
  const slateText = rgb(74 / 255, 92 / 255, 102 / 255); // #4a5c66
  const mutedText = rgb(101 / 255, 114 / 255, 122 / 255); // #65727a
  const lineGrey = rgb(213 / 255, 209 / 255, 201 / 255); // #d5d1c9

  // PAGE 1
  let page = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width, height } = page.getSize();
  const margin = 40;
  const contentWidth = width - margin * 2;

  // Header Banner
  page.drawRectangle({
    x: 0,
    y: height - 120,
    width: width,
    height: 120,
    color: darkNavy,
  });

  // Top Accent Bar
  page.drawRectangle({
    x: 0,
    y: height - 6,
    width: width,
    height: 6,
    color: teal,
  });

  // Name & Title
  page.drawText('CURRICULUM VITAE', {
    x: margin,
    y: height - 32,
    size: 9,
    font: fontBold,
    color: tealBright,
  });

  page.drawText('Hoang Van Hoa (Nova Hoang)', {
    x: margin,
    y: height - 58,
    size: 20,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText(profile.headline, {
    x: margin,
    y: height - 76,
    size: 10,
    font: fontRegular,
    color: rgb(212 / 255, 231 / 255, 228 / 255),
  });

  // Contact line in header
  const contactText = `${contact.email}   |   ${contact.phoneDisplay}   |   ${contact.linkedIn}   |   ${contact.github}`;
  page.drawText(contactText, {
    x: margin,
    y: height - 98,
    size: 8.5,
    font: fontRegular,
    color: rgb(202 / 255, 216 / 255, 220 / 255),
  });

  // Seal on right (Circular matching home page style)
  const sealRadius = 30;
  const sealCenterX = width - margin - sealRadius - 5;
  const sealCenterY = height - 68;

  page.drawCircle({
    x: sealCenterX,
    y: sealCenterY,
    size: sealRadius,
    borderColor: rgb(120 / 255, 187 / 255, 181 / 255),
    borderWidth: 1,
    color: rgb(23 / 255, 43 / 255, 54 / 255),
  });
  page.drawText('7+', {
    x: sealCenterX - 11,
    y: sealCenterY + 4,
    size: 15,
    font: fontBold,
    color: tealBright,
  });
  page.drawText('YEARS OF', {
    x: sealCenterX - 16,
    y: sealCenterY - 9,
    size: 5.5,
    font: fontBold,
    color: rgb(202 / 255, 216 / 255, 220 / 255),
  });
  page.drawText('EXPERIENCE', {
    x: sealCenterX - 19,
    y: sealCenterY - 17,
    size: 5.5,
    font: fontBold,
    color: rgb(202 / 255, 216 / 255, 220 / 255),
  });

  let y = height - 145;

  // Section 1: Professional Summary
  page.drawText('01 / PROFESSIONAL PROFILE', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: teal,
  });
  page.drawLine({
    start: { x: margin + 175, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1,
    color: lineGrey,
  });
  y -= 16;

  const summaryLines = wrapText(profile.summary + ' ' + profile.leadership, contentWidth, fontRegular, 8.5);
  for (const line of summaryLines) {
    page.drawText(line, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12.5;
  }
  y -= 8;

  // Section 2: Core Expertise
  page.drawText('02 / CORE EXPERTISE & CAPABILITIES', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: teal,
  });
  page.drawLine({
    start: { x: margin + 225, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1,
    color: lineGrey,
  });
  y -= 16;

  for (const group of skillGroups) {
    page.drawText(group.label + ':', { x: margin, y, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(group.skills, { x: margin + 120, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 13;
  }
  y -= 10;

  // Section 3: Experience (SJ Group & WATA Corp on Page 1)
  page.drawText('03 / PROFESSIONAL EXPERIENCE', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: teal,
  });
  page.drawLine({
    start: { x: margin + 190, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1,
    color: lineGrey,
  });
  y -= 18;

  // Job 1: SJ Group
  const sj = experiences[0];
  page.drawText(sj.title, { x: margin, y, size: 10.5, font: fontBold, color: darkNavy });
  page.drawText(' |  ' + sj.company, { x: margin + fontBold.widthOfTextAtSize(sj.title, 10.5), y, size: 10.5, font: fontBold, color: teal });
  page.drawText(sj.dates, { x: width - margin - fontBold.widthOfTextAtSize(sj.dates, 9), y, size: 9, font: fontBold, color: mutedText });
  y -= 14;

  const sjSumLines = wrapText(sj.summary, contentWidth, fontRegular, 8.5);
  for (const line of sjSumLines) {
    page.drawText(line, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12;
  }
  y -= 3;

  for (const b of sj.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8.2, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8.2);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8.2);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8.2, font: fontRegular, color: slateText });
      y -= 11.5;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8.2, font: fontRegular, color: slateText });
        y -= 11.5;
      }
    }
  }

  page.drawText('Technologies: ', { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });
  page.drawText(sj.tech, { x: margin + 12 + fontBold.widthOfTextAtSize('Technologies: ', 8), y, size: 8, font: fontRegular, color: teal });
  y -= 22;

  // Job 2: WATA Corp
  const wata = experiences[1];
  page.drawText(wata.title, { x: margin, y, size: 10.5, font: fontBold, color: darkNavy });
  page.drawText(' |  ' + wata.company, { x: margin + fontBold.widthOfTextAtSize(wata.title, 10.5), y, size: 10.5, font: fontBold, color: teal });
  page.drawText(wata.dates, { x: width - margin - fontBold.widthOfTextAtSize(wata.dates, 9), y, size: 9, font: fontBold, color: mutedText });
  y -= 14;

  const wataSumLines = wrapText(wata.summary, contentWidth, fontRegular, 8.5);
  for (const line of wataSumLines) {
    page.drawText(line, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12;
  }
  y -= 3;

  for (const b of wata.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8.2, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8.2);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8.2);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8.2, font: fontRegular, color: slateText });
      y -= 11.5;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8.2, font: fontRegular, color: slateText });
        y -= 11.5;
      }
    }
  }

  page.drawText('Technologies: ', { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });
  page.drawText(wata.tech, { x: margin + 12 + fontBold.widthOfTextAtSize('Technologies: ', 8), y, size: 8, font: fontRegular, color: teal });

  // Page 1 Footer
  page.drawLine({ start: { x: margin, y: 30 }, end: { x: width - margin, y: 30 }, thickness: 0.5, color: lineGrey });
  page.drawText('Hoang Van Hoa (Nova Hoang) — Curriculum Vitae', { x: margin, y: 18, size: 7.5, font: fontRegular, color: mutedText });
  page.drawText('Page 1 of 2', { x: width - margin - 45, y: 18, size: 7.5, font: fontRegular, color: mutedText });

  // PAGE 2
  page = pdfDoc.addPage([595.28, 841.89]);
  y = height - 40;

  // Page 2 Header (Refined, Matching Page 1)
  page.drawRectangle({
    x: 0,
    y: height - 55,
    width: width,
    height: 55,
    color: darkNavy,
  });
  page.drawRectangle({
    x: 0,
    y: height - 55,
    width: width,
    height: 3,
    color: teal,
  });

  page.drawText('Hoang Van Hoa (Nova Hoang)', { x: margin, y: height - 30, size: 12, font: fontBold, color: rgb(1, 1, 1) });
  page.drawText('Career Timeline, Education & Strengths', { x: margin, y: height - 44, size: 8.5, font: fontRegular, color: tealBright });
  page.drawText(`${contact.email}  |  ${contact.phoneDisplay}`, { x: width - margin - 195, y: height - 36, size: 8, font: fontRegular, color: rgb(212 / 255, 231 / 255, 228 / 255) });

  y = height - 80;

  // Job 3: Gumi Vietnam
  const gumi = experiences[2];
  page.drawText(gumi.title, { x: margin, y, size: 10.5, font: fontBold, color: darkNavy });
  page.drawText(' |  ' + gumi.company, { x: margin + fontBold.widthOfTextAtSize(gumi.title, 10.5), y, size: 10.5, font: fontBold, color: teal });
  page.drawText(gumi.dates, { x: width - margin - fontBold.widthOfTextAtSize(gumi.dates, 9), y, size: 9, font: fontBold, color: mutedText });
  y -= 14;

  const gumiSumLines = wrapText(gumi.summary, contentWidth, fontRegular, 8.5);
  for (const line of gumiSumLines) {
    page.drawText(line, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12;
  }
  y -= 3;

  for (const b of gumi.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8.2, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8.2);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8.2);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8.2, font: fontRegular, color: slateText });
      y -= 11.5;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8.2, font: fontRegular, color: slateText });
        y -= 11.5;
      }
    }
  }

  page.drawText('Technologies: ', { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });
  page.drawText(gumi.tech, { x: margin + 12 + fontBold.widthOfTextAtSize('Technologies: ', 8), y, size: 8, font: fontRegular, color: teal });
  y -= 22;

  // Job 4: YOONG Vietnam
  const yoong = experiences[3];
  page.drawText(yoong.title, { x: margin, y, size: 10.5, font: fontBold, color: darkNavy });
  page.drawText(' |  ' + yoong.company, { x: margin + fontBold.widthOfTextAtSize(yoong.title, 10.5), y, size: 10.5, font: fontBold, color: teal });
  page.drawText(yoong.dates, { x: width - margin - fontBold.widthOfTextAtSize(yoong.dates, 9), y, size: 9, font: fontBold, color: mutedText });
  y -= 14;

  const yoongSumLines = wrapText(yoong.summary, contentWidth, fontRegular, 8.5);
  for (const line of yoongSumLines) {
    page.drawText(line, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12;
  }
  y -= 3;

  for (const b of yoong.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8.2, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8.2);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8.2);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8.2, font: fontRegular, color: slateText });
      y -= 11.5;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8.2, font: fontRegular, color: slateText });
        y -= 11.5;
      }
    }
  }

  page.drawText('Technologies: ', { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });
  page.drawText(yoong.tech, { x: margin + 12 + fontBold.widthOfTextAtSize('Technologies: ', 8), y, size: 8, font: fontRegular, color: teal });
  y -= 22;

  // Section 4: Education
  page.drawText('04 / EDUCATION & PROFESSIONAL QUALIFICATIONS', {
    x: margin,
    y: y,
    size: 10,
    font: fontBold,
    color: teal,
  });
  page.drawLine({
    start: { x: margin + 300, y: y + 3 },
    end: { x: width - margin, y: y + 3 },
    thickness: 1,
    color: lineGrey,
  });
  y -= 18;

  for (const edu of education) {
    page.drawText(edu.qualification, { x: margin, y, size: 9, font: fontBold, color: darkNavy });
    page.drawText(edu.dates, { x: width - margin - fontBold.widthOfTextAtSize(edu.dates, 8.5), y, size: 8.5, font: fontBold, color: mutedText });
    y -= 13;
    page.drawText(edu.institution, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 15;
  }
  y -= 10;

  // Key Strengths Box
  page.drawRectangle({
    x: margin,
    y: y - 55,
    width: contentWidth,
    height: 55,
    color: rgb(244 / 255, 248 / 255, 248 / 255), // Soft teal paper
    borderColor: teal,
    borderWidth: 1,
  });

  page.drawText('CORE COMPETENCIES & LEADERSHIP FOCUS', {
    x: margin + 15,
    y: y - 18,
    size: 8.5,
    font: fontBold,
    color: teal,
  });
  page.drawText('Enterprise UI & Complex Workflows  ·  Performance & Rendering  ·  Cross-Functional Team Mentorship  ·  Design Systems', {
    x: margin + 15,
    y: y - 34,
    size: 8,
    font: fontRegular,
    color: darkNavy,
  });
  page.drawText('Available for Senior / Lead Frontend & Full-Stack roles with modern Angular, React, and TypeScript stacks.', {
    x: margin + 15,
    y: y - 47,
    size: 7.5,
    font: fontOblique,
    color: slateText,
  });

  // Page 2 Footer
  page.drawLine({ start: { x: margin, y: 30 }, end: { x: width - margin, y: 30 }, thickness: 0.5, color: lineGrey });
  page.drawText('Hoang Van Hoa (Nova Hoang) — Curriculum Vitae', { x: margin, y: 18, size: 7.5, font: fontRegular, color: mutedText });
  page.drawText('Page 2 of 2', { x: width - margin - 45, y: 18, size: 7.5, font: fontRegular, color: mutedText });

  // Document Metadata
  pdfDoc.setTitle('Hoang Van Hoa (Nova Hoang) — Curriculum Vitae (Vietnam)');
  pdfDoc.setAuthor('Hoang Van Hoa (Nova Hoang)');
  pdfDoc.setSubject('Senior Frontend Developer · Angular & React · Enterprise UI');
  pdfDoc.setKeywords(['Frontend Developer', 'Angular', 'React', 'TypeScript', 'CV', 'Resume', 'Hoang Van Hoa', 'Nova Hoang']);
  pdfDoc.setCreator('Nova Hoang Portfolio (novahoangdev.web.app)');
  pdfDoc.setProducer('pdf-lib');

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  fs.writeFileSync(path.resolve('public/documents/hoang-van-hoa-cv-vietnam.pdf'), pdfBytes);
  console.log('Vietnam CV PDF generated successfully!');
}

async function createInternationalCV() {
  const pdfDoc = await PDFDocument.create();
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

  const teal = rgb(47 / 255, 126 / 255, 124 / 255); // #2f7e7c
  const tealBright = rgb(120 / 255, 187 / 255, 181 / 255); // #78bbb5
  const darkNavy = rgb(23 / 255, 43 / 255, 54 / 255); // #172b36
  const slateText = rgb(74 / 255, 92 / 255, 102 / 255); // #4a5c66
  const mutedText = rgb(101 / 255, 114 / 255, 122 / 255); // #65727a
  const lineGrey = rgb(213 / 255, 209 / 255, 201 / 255); // #d5d1c9

  // PAGE 1
  let page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 40;
  const contentWidth = width - margin * 2;

  // Header
  page.drawText(profile.internationalName, {
    x: margin,
    y: height - 45,
    size: 22,
    font: fontBold,
    color: darkNavy,
  });

  page.drawText(profile.headline, {
    x: margin,
    y: height - 62,
    size: 11,
    font: fontBold,
    color: teal,
  });

  const contactLine = `${contact.email}   •   ${contact.phoneDisplay}   •   ${contact.linkedIn}   •   ${contact.github}`;
  page.drawText(contactLine, {
    x: margin,
    y: height - 78,
    size: 8.5,
    font: fontRegular,
    color: mutedText,
  });

  page.drawLine({
    start: { x: margin, y: height - 88 },
    end: { x: width - margin, y: height - 88 },
    thickness: 1.5,
    color: darkNavy,
  });

  // Visa Status Banner
  page.drawRectangle({
    x: margin,
    y: height - 114,
    width: contentWidth,
    height: 20,
    color: rgb(244 / 255, 248 / 255, 248 / 255),
    borderColor: tealBright,
    borderWidth: 0.8,
  });
  page.drawText(profile.internationalStatus, {
    x: margin + 10,
    y: height - 106,
    size: 7.8,
    font: fontBold,
    color: teal,
  });

  let y = height - 132;

  // Professional Profile
  page.drawText('PROFESSIONAL PROFILE', { x: margin, y, size: 9.5, font: fontBold, color: darkNavy });
  page.drawLine({ start: { x: margin + 140, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 0.8, color: lineGrey });
  y -= 14;

  const profLines = wrapText(profile.summary + ' ' + profile.leadership, contentWidth, fontRegular, 8.5);
  for (const l of profLines) {
    page.drawText(l, { x: margin, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12;
  }
  y -= 6;

  // Core Technical Skills
  page.drawText('CORE TECHNICAL SKILLS', { x: margin, y, size: 9.5, font: fontBold, color: darkNavy });
  page.drawLine({ start: { x: margin + 145, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 0.8, color: lineGrey });
  y -= 14;

  for (const group of skillGroups) {
    page.drawText(group.label + ':', { x: margin, y, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(group.skills, { x: margin + 125, y, size: 8.5, font: fontRegular, color: slateText });
    y -= 12.5;
  }
  y -= 8;

  // Professional Experience
  page.drawText('PROFESSIONAL EXPERIENCE', { x: margin, y, size: 9.5, font: fontBold, color: darkNavy });
  page.drawLine({ start: { x: margin + 155, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 0.8, color: lineGrey });
  y -= 16;

  // Job 1: SJ Group
  const sj = experiences[0];
  page.drawText(sj.title + ' | ' + sj.company, { x: margin, y, size: 10, font: fontBold, color: darkNavy });
  page.drawText(sj.dates, { x: width - margin - fontBold.widthOfTextAtSize(sj.dates, 8.5), y, size: 8.5, font: fontBold, color: mutedText });
  y -= 13;

  const sjSum = wrapText(sj.summary, contentWidth, fontRegular, 8.2);
  for (const l of sjSum) {
    page.drawText(l, { x: margin, y, size: 8.2, font: fontRegular, color: slateText });
    y -= 11.5;
  }
  y -= 2;

  for (const b of sj.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8, font: fontRegular, color: slateText });
      y -= 11;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8, font: fontRegular, color: slateText });
        y -= 11;
      }
    }
  }

  page.drawText('Technologies: ' + sj.tech, { x: margin + 12, y, size: 7.8, font: fontRegular, color: teal });
  y -= 18;

  // Job 2: WATA Corp
  const wata = experiences[1];
  page.drawText(wata.title + ' | ' + wata.company, { x: margin, y, size: 10, font: fontBold, color: darkNavy });
  page.drawText(wata.dates, { x: width - margin - fontBold.widthOfTextAtSize(wata.dates, 8.5), y, size: 8.5, font: fontBold, color: mutedText });
  y -= 13;

  const wataSum = wrapText(wata.summary, contentWidth, fontRegular, 8.2);
  for (const l of wataSum) {
    page.drawText(l, { x: margin, y, size: 8.2, font: fontRegular, color: slateText });
    y -= 11.5;
  }
  y -= 2;

  for (const b of wata.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8, font: fontRegular, color: slateText });
      y -= 11;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8, font: fontRegular, color: slateText });
        y -= 11;
      }
    }
  }

  page.drawText('Technologies: ' + wata.tech, { x: margin + 12, y, size: 7.8, font: fontRegular, color: teal });

  // Page 1 Footer
  page.drawLine({ start: { x: margin, y: 30 }, end: { x: width - margin, y: 30 }, thickness: 0.5, color: lineGrey });
  page.drawText('Nova Hoang (Hoang Van Hoa) — Curriculum Vitae', { x: margin, y: 18, size: 7.5, font: fontRegular, color: mutedText });
  page.drawText('Page 1 of 2', { x: width - margin - 45, y: 18, size: 7.5, font: fontRegular, color: mutedText });

  // PAGE 2
  page = pdfDoc.addPage([595.28, 841.89]);
  y = height - 40;

  // Header Continuation
  page.drawText('Nova Hoang (Hoang Van Hoa)', { x: margin, y, size: 12, font: fontBold, color: darkNavy });
  page.drawText('Curriculum Vitae — Professional Experience (Continued)', { x: margin, y: y - 14, size: 8.5, font: fontRegular, color: teal });
  page.drawText(`${contact.email}  |  ${contact.phoneDisplay}`, { x: width - margin - 180, y: y - 6, size: 8, font: fontRegular, color: mutedText });
  page.drawLine({ start: { x: margin, y: y - 22 }, end: { x: width - margin, y: y - 22 }, thickness: 1, color: lineGrey });

  y = height - 80;

  // Job 3: Gumi Vietnam
  const gumi = experiences[2];
  page.drawText(gumi.title + ' | ' + gumi.company, { x: margin, y, size: 10, font: fontBold, color: darkNavy });
  page.drawText(gumi.dates, { x: width - margin - fontBold.widthOfTextAtSize(gumi.dates, 8.5), y, size: 8.5, font: fontBold, color: mutedText });
  y -= 13;

  const gumiSum = wrapText(gumi.summary, contentWidth, fontRegular, 8.2);
  for (const l of gumiSum) {
    page.drawText(l, { x: margin, y, size: 8.2, font: fontRegular, color: slateText });
    y -= 11.5;
  }
  y -= 2;

  for (const b of gumi.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8, font: fontRegular, color: slateText });
      y -= 11;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8, font: fontRegular, color: slateText });
        y -= 11;
      }
    }
  }

  page.drawText('Technologies: ' + gumi.tech, { x: margin + 12, y, size: 7.8, font: fontRegular, color: teal });
  y -= 18;

  // Job 4: YOONG Vietnam
  const yoong = experiences[3];
  page.drawText(yoong.title + ' | ' + yoong.company, { x: margin, y, size: 10, font: fontBold, color: darkNavy });
  page.drawText(yoong.dates, { x: width - margin - fontBold.widthOfTextAtSize(yoong.dates, 8.5), y, size: 8.5, font: fontBold, color: mutedText });
  y -= 13;

  const yoongSum = wrapText(yoong.summary, contentWidth, fontRegular, 8.2);
  for (const l of yoongSum) {
    page.drawText(l, { x: margin, y, size: 8.2, font: fontRegular, color: slateText });
    y -= 11.5;
  }
  y -= 2;

  for (const b of yoong.bullets) {
    const colonIdx = b.indexOf(':');
    const highlight = b.substring(0, colonIdx + 1);
    const rest = b.substring(colonIdx + 1);

    page.drawCircle({ x: margin + 4, y: y + 2.5, size: 2, color: teal });
    page.drawText(highlight, { x: margin + 12, y, size: 8, font: fontBold, color: darkNavy });

    const highlightW = fontBold.widthOfTextAtSize(highlight, 8);
    const bulletLines = wrapText(rest, contentWidth - 12 - highlightW, fontRegular, 8);

    if (bulletLines.length > 0) {
      page.drawText(bulletLines[0], { x: margin + 12 + highlightW, y, size: 8, font: fontRegular, color: slateText });
      y -= 11;
      for (let i = 1; i < bulletLines.length; i++) {
        page.drawText(bulletLines[i], { x: margin + 12, y, size: 8, font: fontRegular, color: slateText });
        y -= 11;
      }
    }
  }

  page.drawText('Technologies: ' + yoong.tech, { x: margin + 12, y, size: 7.8, font: fontRegular, color: teal });
  y -= 22;

  // Education
  page.drawText('EDUCATION & QUALIFICATIONS', { x: margin, y, size: 9.5, font: fontBold, color: darkNavy });
  page.drawLine({ start: { x: margin + 175, y: y + 3 }, end: { x: width - margin, y: y + 3 }, thickness: 0.8, color: lineGrey });
  y -= 16;

  for (const edu of education) {
    page.drawText(edu.qualification, { x: margin, y, size: 8.5, font: fontBold, color: darkNavy });
    page.drawText(edu.dates, { x: width - margin - fontBold.widthOfTextAtSize(edu.dates, 8), y, size: 8, font: fontBold, color: mutedText });
    y -= 12;
    page.drawText(edu.institution, { x: margin, y, size: 8, font: fontRegular, color: slateText });
    y -= 14;
  }
  y -= 10;

  // Strengths & Relocation (Matching status banner style: soft teal background with teal border)
  page.drawRectangle({
    x: margin,
    y: y - 55,
    width: contentWidth,
    height: 55,
    color: rgb(244 / 255, 248 / 255, 248 / 255),
    borderColor: tealBright,
    borderWidth: 0.8,
  });

  page.drawText('OPEN TO SENIOR FRONTEND & FULL-STACK ROLES', {
    x: margin + 15,
    y: y - 18,
    size: 8.5,
    font: fontBold,
    color: darkNavy,
  });
  page.drawText('Angular  ·  React  ·  TypeScript  ·  Enterprise UI  ·  Design Systems  ·  Cloud & Microservices', {
    x: margin + 15,
    y: y - 32,
    size: 8,
    font: fontBold,
    color: teal,
  });
  page.drawText('Open to international relocation, visa sponsorship & global remote opportunities.', {
    x: margin + 15,
    y: y - 46,
    size: 7.5,
    font: fontRegular,
    color: slateText,
  });

  // Page 2 Footer
  page.drawLine({ start: { x: margin, y: 30 }, end: { x: width - margin, y: 30 }, thickness: 0.5, color: lineGrey });
  page.drawText('Nova Hoang (Hoang Van Hoa) — Curriculum Vitae', { x: margin, y: 18, size: 7.5, font: fontRegular, color: mutedText });
  page.drawText('Page 2 of 2', { x: width - margin - 45, y: 18, size: 7.5, font: fontRegular, color: mutedText });

  // Document Metadata
  pdfDoc.setTitle('Nova Hoang (Hoang Van Hoa) — Curriculum Vitae (International)');
  pdfDoc.setAuthor('Nova Hoang (Hoang Van Hoa)');
  pdfDoc.setSubject('Senior Frontend Developer · Angular & React · Enterprise UI · International & Remote');
  pdfDoc.setKeywords(['Frontend Developer', 'Angular', 'React', 'TypeScript', 'CV', 'Resume', 'International', 'Global', 'Remote', 'Nova Hoang']);
  pdfDoc.setCreator('Nova Hoang Portfolio (novahoangdev.web.app)');
  pdfDoc.setProducer('pdf-lib');

  const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
  fs.writeFileSync(path.resolve('public/documents/nova-hoang-cv-international.pdf'), pdfBytes);
  console.log('International CV PDF generated successfully!');
}

async function run() {
  await createVietnamCV();
  await createInternationalCV();
}

run();
