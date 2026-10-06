import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('dist/portfolio/browser');
const template = await readFile(resolve(output, 'index.html'), 'utf8');
const pages = JSON.parse(await readFile('src/app/data/page-metadata.json', 'utf8'));
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

for (const [route, page] of Object.entries(pages)) {
  const url = `https://novahoangdev.web.app${route}`;
  const values = {
    description: page.description,
    robots: page.robots,
    'og:title': page.title,
    'og:description': page.description,
    'og:url': url,
    'twitter:title': page.title,
    'twitter:description': page.description,
  };
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(page.title)}</title>`)
    .replace(/<meta\b[^>]*(?:name|property)="([^"]+)"[^>]*>/g, (tag, name) =>
      values[name] ? tag.replace(/content="[^"]*"/, `content="${escape(values[name])}"`) : tag,
    )
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/, (tag) =>
      tag.replace(/href="[^"]*"/, `href="${url}"`),
    );
  const directory = resolve(output, `.${route}`);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, 'index.html'), html);
}
