// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Los Nanuqs de los manuales salen del código de la app: los trazos del oso (<defs> de index.html), los accesorios de
// cada tema (BEAR_ACC), el DJ (djBearSVG) y los colores (THEMES). Si cambian en la app, los manuales los siguen.
const fs = require('fs');
module.exports = R => {
  const html = fs.readFileSync(R + '/web/index.html', 'utf8'), app = fs.readFileSync(R + '/web/app.js', 'utf8');
  const DEFS = [...html.matchAll(/<path id="djb-[^>]+\/>/g)].map(m => m[0]).join('');
  const BEAR_ACC = JSON.parse(/const BEAR_ACC = (\{.*\});\n/.exec(app)[1]);
  const djBearSVG = new Function(/function djBearSVG\([\s\S]*?<\/svg>`;\n}\n/.exec(app)[0] + ';return djBearSVG')();
  const THEMES = new Function('tx', 'return ' + /const THEMES = (\{[\s\S]*?\n\});/.exec(app)[1])(x => x);
  const VERSION = /const VERSION = '([\d.]+)'/.exec(app)[1];
  const parts = ['body', 'belly', 'head', 'muzzle', 'nose', 'eyes'].map(i => `<use href="#djb-${i}"/>`).join('');
  // Nanuq con el disfraz de un tema (mismas coordenadas que la app: 512×488 dentro de un viewBox con margen).
  const bear = (theme = 'navy', cls = '') => `<svg class="nq ${cls}" viewBox="-70 -150 652 660" aria-hidden="true"><g transform="scale(1.4222 1.4227)">${parts}</g>${BEAR_ACC[theme] || ''}</svg>`;
  // DJ Nanuq con el color de acento que se elija.
  const dj = (accent = '#3cc0f5', cls = 'on') => `<span style="--accent:${accent};display:contents">${djBearSVG(cls)}</span>`;
  const rng = seed => { let s = 0; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const snow = (seed, n = 70, w = 210, h = 297, op = .8) => { const r = rng(seed); let s = ''; for (let k = 0; k < n; k++) s += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(.25 + r() * .9).toFixed(2)}" fill="#fff" opacity="${(.2 + r() * op).toFixed(2)}"/>`; return `<svg class="snow" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${s}</svg>`; };
  return { DEFS, BEAR_ACC, THEMES, VERSION, bear, dj, snow, rng };
};
