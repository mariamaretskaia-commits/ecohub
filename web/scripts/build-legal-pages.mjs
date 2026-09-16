/**
 * Генерирует статические страницы политики и правил (web/public/*.html)
 * из того же источника, что и в приложении (web/src/legal.js).
 * URL: /privacy.html, /rules.html.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LEGAL_DOCS } from '../src/legal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const outDate = new Date().toISOString().slice(0, 10);

const STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0 auto; max-width: 720px; padding: 24px 18px 64px; font: 16px/1.65 Georgia, 'Times New Roman', serif; color: #1d2b22; background: #fbfdfb; }
  h1 { font-size: 26px; line-height: 1.3; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 28px 0 8px; }
  .sub { color: #59705f; font-size: 14px; margin: 0 0 24px; }
  p { margin: 8px 0; }
  ul { margin: 6px 0 10px; padding-left: 22px; }
  li { margin: 4px 0; }
  .note { color: #59705f; font-size: 14px; }
  footer { margin-top: 40px; padding-top: 14px; border-top: 1px solid #d8e6db; color: #59705f; font-size: 13px; }
`;

function render(doc) {
  const parts = [];
  parts.push('<!doctype html>');
  parts.push('<html lang="ru">');
  parts.push('<head>');
  parts.push('<meta charset="utf-8">');
  parts.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  parts.push(`<title>${doc.title} – EcoHub</title>`);
  parts.push(`<style>${STYLE}</style>`);
  parts.push('</head>');
  parts.push('<body>');
  parts.push(`<h1>${doc.title}</h1>`);
  if (doc.subtitle) parts.push(`<p class="sub">${doc.subtitle}</p>`);

  for (const sec of doc.sections || []) {
    parts.push(`<h2>${sec.h}</h2>`);
    for (const it of sec.items || []) parts.push(`<p>${it}</p>`);
    if (sec.intro) parts.push(`<p>${sec.intro}</p>`);
    if (sec.list?.length) {
      parts.push('<ul>');
      for (const li of sec.list) parts.push(`<li>${li}</li>`);
      parts.push('</ul>');
    }
    for (const it of sec.after || []) parts.push(`<p>${it}</p>`);
    if (sec.list2?.length) {
      parts.push('<ul>');
      for (const li of sec.list2) parts.push(`<li>${li}</li>`);
      parts.push('</ul>');
    }
    for (const it of sec.after2 || []) parts.push(`<p>${it}</p>`);
    if (sec.footnote) parts.push(`<p class="note">${sec.footnote}</p>`);
  }

  parts.push('<footer>EcoHub · актуальная редакция опубликована в приложении и на этой странице.</footer>');
  parts.push('</body>');
  parts.push('</html>');
  return parts.join('\n');
}

fs.mkdirSync(publicDir, { recursive: true });

fs.writeFileSync(
  path.join(publicDir, 'privacy.html'),
  render(LEGAL_DOCS.privacy).replace('</head>', `<meta name="generator" content="EcoHub legal @ ${outDate}"></head>`),
  'utf8',
);
fs.writeFileSync(
  path.join(publicDir, 'rules.html'),
  render(LEGAL_DOCS.rules).replace('</head>', `<meta name="generator" content="EcoHub legal @ ${outDate}"></head>`),
  'utf8',
);

console.log('📄 Правовые страницы обновлены: web/public/privacy.html, web/public/rules.html');