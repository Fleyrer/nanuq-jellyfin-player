// SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
// SPDX-License-Identifier: GPL-3.0-or-later
// Lo que la página puede pedirle al proceso principal: buscar servidores Jellyfin en la red (UDP)
// hacer peticiones HTTP sin CORS (para SomeDL, en «Solicitar canción») y guardar los datos personales cifrados.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('nanuqDesktop', {
  discover: () => ipcRenderer.invoke('nanuq:discover'),
  http: (method, url, body) => ipcRenderer.invoke('nanuq:http', { method, url, body }),
  // Almacén cifrado de los datos personales (ver SEC en app.js y en main.js). Síncrono, como localStorage.
  // «Escuchando Nanuq» en Discord (Rich Presence): la página manda lo que suena (o null para quitarlo).
  discord: a => ipcRenderer.invoke('nanuq:discord', a),
  // Fiesta (watch party): esta computadora abre una sala y los teléfonos de tu red le mandan canciones.
  party: {
    op: o => ipcRenderer.invoke('nanuq:party', o),
    on: cb => { if (typeof cb === 'function') ipcRenderer.on('nanuq:party-ev', (e, ev) => cb(ev)); }
  },
  secure: {
    kind: () => ipcRenderer.sendSync('nanuq:sec', { op: 'kind' }),
    get: k => ipcRenderer.sendSync('nanuq:sec', { op: 'get', k }),
    set: (k, v) => ipcRenderer.sendSync('nanuq:sec', { op: 'set', k, v }),
    del: k => ipcRenderer.sendSync('nanuq:sec', { op: 'del', k }),
    reset: () => ipcRenderer.invoke('nanuq:secreset') // «Empezar de cero» cuando los datos ya no se pueden abrir
  }
});
