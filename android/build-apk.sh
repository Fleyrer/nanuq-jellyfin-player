#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
# SPDX-License-Identifier: GPL-3.0-or-later
# Compila el APK de Nanuq y lo deja en ../dist/<versión>/
# Uso: ./build-apk.sh            (release firmado)
#      ./build-apk.sh debug      (debug, depurable con chrome://inspect)
set -euo pipefail
cd "$(dirname "$0")"
export JAVA_HOME="${JAVA_HOME_NANUQ:-$HOME/.local/opt/jdk21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
type="${1:-release}"
ver=$(grep -oP "const VERSION = '\K[0-9.]+" ../web/app.js)
./gradlew "assemble${type^}" --console=plain -q
mkdir -p "../dist/$ver"
apk="app/build/outputs/apk/$type/nanuq-$ver-$type.apk"
cp "$apk" "../dist/$ver/"
echo "APK listo: $(realpath "../dist/$ver/$(basename "$apk")")"
