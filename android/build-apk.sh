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
# Prueba automática de OggCheck (integridad de las descargas Opus): si falla, no hay APK.
t=$(mktemp -d)
javac -d "$t" app/src/main/java/com/nanuq/app/OggCheck.java test/OggCheckTest.java
java -cp "$t" com.nanuq.app.OggCheckTest || { rm -rf "$t"; echo "La prueba de OggCheck falló: no se compila el APK" >&2; exit 1; }
rm -rf "$t"
# Prueba del reproductor del puente (android-bridge.js, NanuqNativeAudio): si falla, no hay APK.
command -v node >/dev/null || { echo "Falta Node.js: lo usa la prueba del reproductor (android/test/*.test.js)" >&2; exit 1; }
node --test test/*.test.js >/dev/null || { echo "La prueba del puente de audio falló (node --test android/test/*.test.js): no se compila el APK" >&2; exit 1; }
./gradlew "assemble${type^}" --console=plain -q
mkdir -p "../dist/$ver"
apk="app/build/outputs/apk/$type/nanuq-$ver-$type.apk"
cp "$apk" "../dist/$ver/"
echo "APK listo: $(realpath "../dist/$ver/$(basename "$apk")")"
