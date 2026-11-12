// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Carga linux/main.js TAL CUAL para las pruebas, con un «electron» falso: whenReady nunca termina (la app no arranca),
// app.getPath da la carpeta que se pida y ipcMain guarda los manejadores para poder llamarlos. Al final se le agrega una
// línea que expone lo que se quiere probar (en el mismo ámbito del módulo).
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
module.exports = function cargarMain(expose, dir = require('os').tmpdir()) {
  const handlers = {};
  const fake = new Proxy(function () { }, {
    get: (t, k) => k === 'whenReady' ? () => new Promise(() => { }) : k === 'then' ? undefined : fake,
    apply: () => fake
  });
  const ipcMain = new Proxy({}, { get: (t, k) => (k === 'on' || k === 'handle') ? (n, fn) => { handlers[n] = fn; } : fake });
  const app = new Proxy({}, { get: (t, k) => k === 'getPath' ? () => dir : k === 'whenReady' ? () => new Promise(() => { }) : fake });
  const file = path.join(__dirname, '..', 'main.js');
  const src = fs.readFileSync(file, 'utf8') + '\n;globalThis.__t = { ' + expose + ' };';
  const fn = vm.compileFunction(src, ['require', 'module', 'exports', '__dirname', '__filename'], { filename: file });
  const req = m => m === 'electron' ? { app, BrowserWindow: fake, shell: fake, nativeTheme: fake, ipcMain, safeStorage: fake } : require(m);
  fn(req, { exports: {} }, {}, path.dirname(file), file);
  const t = globalThis.__t; delete globalThis.__t;
  t.handlers = handlers;
  return t;
};
