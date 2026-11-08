#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
# SPDX-License-Identifier: GPL-3.0-or-later
# Arma Nanuq como Flatpak a partir de la compilación de Electron y lo publica en un repositorio local,
# para que las versiones nuevas lleguen como actualizaciones (centro de software o «flatpak update").
#
# Uso: ./build-flatpak.sh            publica en el repositorio local y deja ../../dist/<versión>/nanuq-<versión>.flatpak
#      ./build-flatpak.sh --install  además instala o actualiza la app en el sistema (pide contraseña)
#
# Repositorio local: ~/.local/share/nanuq/flatpak-repo (cambia con NANUQ_FLATPAK_REPO), firmado con una llave
# GPG propia en ~/.local/share/nanuq/gpg. Flatpak exige firma para instalar en el sistema desde un repositorio.
# El .flatpak sirve para llevarlo a otra computadora: «flatpak install nanuq-<versión>.flatpak» encima de una
# versión anterior la actualiza (desde la terminal; el centro de software no actualiza desde un archivo suelto).
set -euo pipefail
cd "$(dirname "$0")"
VER=$(node -p "require('../package.json').version")
B=../../dist/_build/flatpak   # carpetas de trabajo de flatpak-builder (fuera del código)
DATA="$HOME/.local/share/nanuq"
REPO="${NANUQ_FLATPAK_REPO:-$DATA/flatpak-repo}"
GPGH="${NANUQ_GPG_HOME:-$DATA/gpg}"
PUB="$DATA/nanuq-repo.gpg"
REMOTE=nanuq-local
[ -d ../../dist/_build/linux-unpacked ] || (cd .. && npm run dist)
sed -i "s/<release version=\"[^\"]*\" date=\"[^\"]*\"\/>/<release version=\"$VER\" date=\"$(date +%F)\"\/>/; s/@VERSION@/$VER/; s/@DATE@/$(date +%F)/" com.nanuq.app.metainfo.xml
mkdir -p "$B" "../../dist/$VER" "$REPO" "$DATA"

# Llave para firmar el repositorio (se crea una sola vez, sin contraseña: solo firma tus propias compilaciones).
if ! gpg --homedir "$GPGH" --list-secret-keys --with-colons 2>/dev/null | grep -q '^sec'; then
  mkdir -p "$GPGH" && chmod 700 "$GPGH"
  gpg --homedir "$GPGH" --batch --passphrase '' --quick-gen-key "Nanuq repositorio local <nanuq@localhost>" rsa4096 sign never
fi
KEY=$(gpg --homedir "$GPGH" --list-secret-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')
gpg --homedir "$GPGH" --export "$KEY" > "$PUB"

flatpak run org.flatpak.Builder --user --force-clean --repo="$REPO" --state-dir="$B/flatpak-builder" "$B/build" com.nanuq.app.yml
flatpak build-sign "$REPO" com.nanuq.app master --gpg-sign="$KEY" --gpg-homedir="$GPGH"
flatpak build-update-repo --gpg-sign="$KEY" --gpg-homedir="$GPGH" --prune --prune-depth=3 "$REPO" >/dev/null
flatpak build-bundle "$REPO" "../../dist/$VER/nanuq-$VER.flatpak" com.nanuq.app --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo
echo "Listo: $(realpath "../../dist/$VER/nanuq-$VER.flatpak") (y publicado en $REPO)"

# Se instala en el sistema (como lo tienes ahora). Mezclar instalaciones --user y de sistema deja íconos viejos en GNOME.
if [ "${1:-}" = "--install" ]; then
  if ! flatpak remotes --system --columns=name | grep -qx "$REMOTE"; then
    flatpak remote-add --system --if-not-exists --title="Nanuq (esta computadora)" --gpg-import="$PUB" "$REMOTE" "file://$REPO"
  fi
  if [ "$(flatpak info --system --show-origin com.nanuq.app 2>/dev/null || true)" = "$REMOTE" ]; then
    flatpak update --system -y --noninteractive com.nanuq.app
  else
    # Instalada desde un archivo .flatpak (origen «app-origin», que no se puede actualizar): se pasa al repositorio
    # local. Tus datos (sesión, ajustes, cola) están en ~/.var/app/com.nanuq.app y no se tocan.
    flatpak install --system -y --noninteractive --reinstall "$REMOTE" com.nanuq.app
  fi
fi
