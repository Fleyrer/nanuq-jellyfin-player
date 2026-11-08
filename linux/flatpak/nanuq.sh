#!/bin/sh
# SPDX-FileCopyrightText: 2026 Fleyrer y colaboradores de Nanuq
# SPDX-License-Identifier: GPL-3.0-or-later
# Carpeta temporal propia para que el candado de "una sola ventana" funcione dentro del sandbox.
export TMPDIR="$XDG_RUNTIME_DIR/app/$FLATPAK_ID"
exec zypak-wrapper /app/nanuq/nanuq "$@"
