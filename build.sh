#!/usr/bin/env bash
# Gera o zip para enviar ao extensions.gnome.org
set -e
cd "$(dirname "$0")"
mkdir -p dist
gnome-extensions pack --force --out-dir=dist --podir=po --extra-source=LICENSE
ls -1 dist/*.zip
