#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
# SPDX-License-Identifier: GPL-3.0-or-later
# Compila Nanuq para todas las plataformas y deja los paquetes en dist/<versión>/.
#
# Uso: scripts/build.sh [versión | patch | minor | major] [android] [linux] [flatpak] [windows]
#   scripts/build.sh                 recompila todo con la versión actual
#   scripts/build.sh patch           1.21.3 → 1.21.4 y compila todo
#   scripts/build.sh minor           1.21.3 → 1.22.0 y compila todo
#   scripts/build.sh 2.0.0 android   pone la versión 2.0.0 y compila solo el APK
#   scripts/build.sh windows         solo el instalador de Windows (necesita Wine)
#
# La versión vive en web/app.js (const VERSION) y en web/sw.js (CACHE);
# el APK, el package.json de Linux y el Flatpak la toman de ahí.
set -euo pipefail
cd "$(dirname "$0")/.."

cur=$(grep -oP "const VERSION = '\K[0-9]+\.[0-9]+\.[0-9]+" web/app.js)
ver=$cur
targets=()
for a in "$@"; do
  case "$a" in
    patch|minor|major)
      IFS=. read -r M m p <<< "$cur"
      case "$a" in patch) p=$((p + 1));; minor) m=$((m + 1)); p=0;; major) M=$((M + 1)); m=0; p=0;; esac
      ver="$M.$m.$p";;
    [0-9]*.[0-9]*.[0-9]*) ver=$a;;
    android|linux|flatpak|windows) targets+=("$a");;
    -h|--help) sed -n '4,14p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "No entiendo «$a». Usa: scripts/build.sh --help" >&2; exit 1;;
  esac
done
if [ ${#targets[@]} -eq 0 ]; then targets=(android linux flatpak); command -v wine >/dev/null && targets+=(windows); fi
want() { [[ " ${targets[*]} " == *" $1 "* ]]; }

if [ "$ver" != "$cur" ]; then
  sed -i "s/const VERSION = '$cur'/const VERSION = '$ver'/" web/app.js
  sed -i "s/nanuq-v[0-9.]*';/nanuq-v$ver';/" web/sw.js
  grep -q "const VERSION = '$ver'" web/app.js && grep -q "nanuq-v$ver'" web/sw.js || { echo "No se pudo cambiar la versión" >&2; exit 1; }
  echo "Versión: $cur → $ver"
else
  echo "Versión: $ver"
fi

# El Flatpak se arma con la compilación de Linux: si falta o es de otra versión, se compila también.
if want flatpak && ! want linux; then
  built=$(node -p "require('./linux/package.json').version")
  [ -d dist/_build/linux-unpacked ] && [ "$built" = "$ver" ] || targets+=(linux)
fi

if want android; then echo; echo "== Android"; android/build-apk.sh; fi
if want linux; then
  echo; echo "== Linux (AppImage y RPM)"
  [ -d linux/node_modules ] || (cd linux && npm install)
  (cd linux && npm run dist 2>&1 | grep -E '^Listo:|rror' || true)
  ls "dist/$ver"/nanuq-"$ver"-x86_64.AppImage >/dev/null # falla si no se generó
fi
if want flatpak; then echo; echo "== Flatpak"; linux/flatpak/build-flatpak.sh | tail -1; fi
if want windows; then
  echo; echo "== Windows (instalador NSIS)"
  command -v wine >/dev/null || { echo "Falta Wine: sudo dnf install wine" >&2; exit 1; }
  [ -d linux/node_modules ] || (cd linux && npm install)
  (cd linux && npm run dist:win 2>&1 | grep -E '^Listo:|rror' || true)
  ls "dist/$ver"/nanuq-"$ver"-setup.exe >/dev/null # falla si no se generó
fi

echo; echo "Paquetes en dist/$ver/:"; ls -1sh "dist/$ver"
