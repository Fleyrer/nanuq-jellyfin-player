// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Tras electron-builder: mueve el AppImage y el RPM de dist/_build a dist/<versión>/.
// (linux-unpacked se queda en dist/_build: de ahí se arma el Flatpak.)
const fs = require('fs'), path = require('path');
const ver = require('./package.json').version;
const build = path.join(__dirname, '..', 'dist', '_build'), out = path.join(__dirname, '..', 'dist', ver);
fs.mkdirSync(out, { recursive: true });
for (const f of fs.readdirSync(build)) {
  if (!f.startsWith(`nanuq-${ver}-`) || !/\.(AppImage|rpm|exe)$/.test(f)) continue;
  fs.renameSync(path.join(build, f), path.join(out, f));
  console.log('Listo:', path.join(out, f));
}
for (const f of fs.readdirSync(build)) if (/\.blockmap$/.test(f)) fs.rmSync(path.join(build, f)); // solo sirven para auto-actualizar
