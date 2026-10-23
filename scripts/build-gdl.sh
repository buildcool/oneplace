#!/bin/sh
# Bundles gallery-dl and its pure-Python dependencies for the APK (android/app/src/main/assets/gdl.zip).
# The APK's Python (from youtubedl-android) only ships mutagen and pycryptodomex, so requests & co come along.
set -eu
out="$(pwd)/android/app/src/main/assets/gdl.zip"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
python3 -m pip download --quiet --disable-pip-version-check --only-binary=:all: --no-deps \
  --python-version 3.12 --implementation py --abi none --platform any \
  -d "$work/wheels" gallery-dl requests urllib3 idna charset-normalizer certifi
mkdir -p "$work/site"
for w in "$work"/wheels/*.whl; do python3 -m zipfile -e "$w" "$work/site"; done
rm -rf "$work"/site/*.dist-info "$work"/site/bin
mkdir -p "$(dirname "$out")"
rm -f "$out"
(cd "$work/site" && python3 -m zipfile -c "$out" $(ls))
ls "$work/wheels"
python3 -c "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(len(z.namelist()), 'files,', sum(i.file_size for i in z.infolist())//1024, 'KB unpacked')" "$out"
