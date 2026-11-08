// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Arma los manuales de Nanuq en PDF (español e inglés): node docs/manuals/src/build.js
// Necesita Chromium a través de playwright-core (una herramienta de documentación, no va en la app): si no está en el
// NODE_PATH, indica su carpeta con NANUQ_PLAYWRIGHT=/ruta/a/node_modules/playwright-core y el navegador con
// NANUQ_CHROME=/ruta/a/chrome. También usa pdftotext (poppler) para poner los números de página del índice.
// Las capturas de img/ se toman de la app en modo demo; el texto de cada función sale de functions.tsv.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const R = path.resolve(__dirname, '..', '..', '..'), SRC = __dirname, OUT = path.resolve(SRC, '..');
const A = require('./assets')(R);
const { chromium } = require(process.env.NANUQ_PLAYWRIGHT || 'playwright-core');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- Piezas comunes ----
const H = L => ({
  L, A, esc,
  t: (es, en) => L === 'es' ? es : en,
  shot: (name, cap, cls = '') => `<div class="shot ${cls}"><img src="img/${L}-${name}.jpg" alt="">${cap ? `<div class="cap">${cap}</div>` : ''}</div>`,
  tip: (html, theme = 'navy', warn = false) => `<div class="tip${warn ? ' warn' : ''}">${A.bear(theme)}<div><b class="h">${warn ? (L === 'es' ? 'Ojo' : 'Heads-up') : (L === 'es' ? 'Consejo de Nanuq' : "Nanuq's tip")}</b>${html}</div></div>`,
  table: (head, rows) => `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  steps: items => `<ol class="steps">${items.map(i => `<li>${i}</li>`).join('')}</ol>`
});
const COLORS = [['navy', '#1e88d6', '#3cc0f5'], ['pony', '#d62f7e', '#ff6fb0'], ['leaf', '#1f9a55', '#5bd68a'], ['gato', '#e0700a', '#ffa64d'], ['uva', '#6c3fd1', '#a77bff'], ['synth', '#b0217a', '#ff3cac'], ['caribe', '#00897d', '#2ed3c6'], ['chile', '#c22020', '#ff5a5a'], ['abejita', '#c79b00', '#ffcc00'], ['cafe', '#7a4a26', '#b07a4f'], ['aurora', '#0b8f6a', '#38f2b0'], ['invierno', '#1f5fa8', '#5aa2ea'], ['sandia', '#c4243c', '#ff5d73'], ['girasol', '#a87300', '#e0a800'], ['chocolate', '#6b4026', '#b8844f'], ['amoled', '#222', '#555'], ['dark', '#2a5f86', '#2aa8f2'], ['light', '#1ea7e6', '#6cc8f2']];

function cover(doc, L) {
  const tech = doc.kind === 'tech', r = A.rng(doc.kind + L);
  const aur = `<svg class="aur" viewBox="0 0 400 120" preserveAspectRatio="none"><path d="M0 70C70 20 130 90 200 50S330 10 400 60" stroke="#38f2b0" stroke-width="16" fill="none" opacity=".55"/><path d="M0 90C80 40 150 110 220 70S340 40 400 80" stroke="#8b7bff" stroke-width="12" fill="none" opacity=".5"/><path d="M0 50C90 0 160 70 240 30S350 0 400 40" stroke="#5be7ff" stroke-width="8" fill="none" opacity=".45"/></svg>`;
  const ice = `<svg class="ice" viewBox="0 0 210 62" preserveAspectRatio="none"><path d="M0 26Q60 6 110 18T210 14V62H0Z" fill="#dff0ff" opacity=".18"/><path d="M0 38Q70 22 120 32T210 28V62H0Z" fill="#eaf6ff" opacity=".28"/></svg>`;
  const crew = (tech ? ['synth', 'uva', 'navy', 'aurora', 'chile', 'caribe'] : ['pony', 'gato', 'leaf', 'cafe', 'caribe', 'invierno']).map(t => A.bear(t)).join('');
  return `<section class="cover${tech ? ' tech' : ''}">${tech ? '<div class="grid"></div>' : ''}${aur}${A.snow(doc.kind + L, 90)}
    <div class="brand"><div class="word">nan<b>u</b>q</div><div class="kind">${esc(doc.kind === 'tech' ? (L === 'es' ? 'Manual técnico' : 'Technical manual') : (L === 'es' ? 'Manual de usuario' : 'User manual'))}</div>
    <h1>${doc.title}</h1><div class="sub">${doc.subtitle}</div></div>
    <div class="hero">${A.dj(tech ? '#ff3cac' : '#3cc0f5', 'on big')}</div>${ice}<div class="crew">${crew}</div>
    <div class="meta">${L === 'es' ? 'Versión' : 'Version'} ${A.VERSION} · ${new Date().toLocaleDateString(L === 'es' ? 'es-MX' : 'en-US', { year: 'numeric', month: 'long', day: 'numeric' })} · ${L === 'es' ? 'Español' : 'English'} · ${L === 'es' ? 'Software libre' : 'Free software'} (GPL-3.0-or-later)</div></section>`;
}
function toc(doc, L, pages) {
  let n = 0;
  const items = doc.toc.map(e => {
    if (e.part) return `<li class="part"><span class="t">${e.title}</span></li>`;
    const p = pages[e.id] || '··', c = COLORS[(e.ci ?? n) % COLORS.length];
    if (e.sub) return `<li class="sub2"><span class="t">${e.title}</span><span class="p">${p}</span></li>`;
    n++;
    return `<li><span class="n" style="background:linear-gradient(135deg,${c[1]},${c[2]})">${e.num ?? n}</span><span class="t">${e.title}${e.desc ? `<small>${e.desc}</small>` : ''}</span><span class="p">${p}</span></li>`;
  }).join('');
  return `<section class="toc"><div class="tt">${A.bear(doc.kind === 'tech' ? 'synth' : 'navy')}<div><h1>${L === 'es' ? 'Índice' : 'Contents'}</h1><p>${doc.tocLead}</p></div></div><ol>${items}</ol></section>`;
}
const opener = (num, title, lead, ci) => { const c = COLORS[ci % COLORS.length]; return `<div class="opener" style="background:linear-gradient(120deg,${c[1]},${c[2]})">${A.snow('op' + num + title, 25, 180, 50, .6).replace('class="snow"', 'class="flakes"')}<div class="num">${String(num).padStart(2, '0')}</div><div><h1>${title}</h1>${lead ? `<p>${lead}</p>` : ''}</div>${A.bear(c[0])}</div>`; };
const mk = id => `<span class="mk">@@${id}@@</span>`;

function documentHTML(doc, L, pages) {
  const body = doc.sections.map(s => {
    if (s.part) return `<section class="part-page">${mk(s.id)}<div class="lbl">${s.label}</div><h1>${s.title}</h1><p>${s.lead || ''}</p>${s.art || ''}</section>`;
    return `<section class="chap">${mk(s.id)}${opener(s.num, s.title, s.lead, s.ci)}${s.html}</section>`;
  }).join('');
  const back = `<section class="back">${A.snow('back' + L, 80)}<div class="msg"><h1>${doc.backTitle}</h1><p>${doc.backText}</p></div>${A.dj('#3cc0f5', 'on big').replace('<svg class="djbear', '<svg class="big djbear')}</section>`;
  return `<!DOCTYPE html><html lang="${L}"><head><meta charset="utf-8"><title>${esc(doc.pdfTitle)}</title><link rel="stylesheet" href="manual.css">
    <style>@page{--foot:""}:root{--foot:"${doc.foot}"}@page{@bottom-left{content:"${doc.foot}"}}</style></head><body>
    <svg width="0" height="0" style="position:absolute"><defs>${A.DEFS}</defs></svg>
    ${cover(doc, L)}${toc(doc, L, pages)}${body}${back}</body></html>`;
}

// ---- PDF con números de página en el índice (dos pasadas) ----
async function render(browser, doc, L) {
  const tmp = path.join(SRC, `_${doc.file}-${L}.html`), out = path.join(OUT, L, doc.file + '.pdf');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  let pages = {};
  for (let pass = 0; pass < 2; pass++) {
    fs.writeFileSync(tmp, documentHTML(doc, L, pages));
    const pg = await browser.newPage();
    await pg.goto('file://' + tmp, { waitUntil: 'networkidle' });
    await pg.evaluate(() => document.fonts.ready);
    await pg.pdf({ path: out, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
    await pg.close();
    const txt = cp.execFileSync('pdftotext', [out, '-'], { maxBuffer: 64 << 20 }).toString().split('\f');
    pages = {}; txt.forEach((t, i) => { for (const m of t.matchAll(/@@([\w\s-]+?)@@/g)) { const id = m[1].replace(/\s+/g, ''); if (!pages[id]) pages[id] = i + 1; } }); // con letra de 1 px, pdftotext separa las letras
  }
  fs.rmSync(tmp);
  const n = cp.execFileSync('pdfinfo', [out]).toString().match(/Pages:\s+(\d+)/)[1];
  console.log('Listo:', path.relative(R, out), '·', n, L === 'es' ? 'páginas' : 'pages', '·', Math.round(fs.statSync(out).size / 1024), 'KB');
}

(async () => {
  const browser = await chromium.launch(process.env.NANUQ_CHROME ? { executablePath: process.env.NANUQ_CHROME } : {});
  for (const L of ['es', 'en']) {
    for (const mod of ['./user.js', './tech.js']) await render(browser, require(mod)(H(L)), L);
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
