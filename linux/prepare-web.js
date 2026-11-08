// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Copia la PWA (../web) a www/ y toma la versión de app.js.
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', 'web'), out = path.join(__dirname, 'www');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const f of ['index.html', 'i18n.js', 'app.js', 'app.css', 'manifest.webmanifest']) fs.copyFileSync(path.join(root, f), path.join(out, f));
fs.cpSync(path.join(root, 'icons'), path.join(out, 'icons'), { recursive: true });
const m = fs.readFileSync(path.join(root, 'app.js'), 'utf8').match(/const VERSION = '(\d+\.\d+\.\d+)'/);
if (m) {
  const pkgPath = path.join(__dirname, 'package.json'), pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.version !== m[1]) { pkg.version = m[1]; fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n'); }
}
console.log('www/ lista, versión', m ? m[1] : '?');
