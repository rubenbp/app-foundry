#!/bin/sh
# Exporta la memoria (apartados 00 a 06) a docs/tfm/memoria.pdf.
# Uso: sh docs/tfm/export/exportar.sh
# Requiere Google Chrome 131 o posterior (cabeceras y pies con @page) y npx.
set -eu

TFM_DIR=$(cd "$(dirname "$0")/.." && pwd)
CHROME=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
OUTPUT="$TFM_DIR/memoria.pdf"
WORK=$(mktemp -d)
# El HTML vive junto a los apartados para que las rutas img/ y video/ se resuelvan igual que en Markdown.
PAGE="$TFM_DIR/.memoria-export.html"
trap 'rm -rf "$WORK" "$PAGE"' EXIT

cat "$TFM_DIR"/0[0-6]-*.md > "$WORK/memoria.md"
npx -y marked@18.1.1 --gfm -i "$WORK/memoria.md" -o "$WORK/cuerpo.html"

perl -0pi -e '
  s#<p><img src="([^"]+)" alt="([^"]*)"\s*/?></p>#<figure><img src="$1" alt=""><figcaption>$2</figcaption></figure>#g;
  s#<figure>(<img src="img/fig-(?:07|09|10)-)#<figure class="alta">$1#g;
  s#<figure>(<img src="img/fig-12-gemini)#<figure class="ancha">$1#g;
  s#<figure>(<img src="img/fig-13-consumo)#<figure class="reducida">$1#g;
' "$WORK/cuerpo.html"

{
  printf '%s\n' '<!doctype html><html lang="es"><head><meta charset="utf-8">' \
    '<title>App Foundry · Memoria del TFM</title>' \
    '<link rel="stylesheet" href="export/memoria.css"></head><body>' \
    '<header class="portada"><img src="export/jakala-logo.png" alt="JAKALA">' \
    '<span>Trabajo Fin de Máster<br>Track 1 · Desarrollo de Código</span></header>'
  cat "$WORK/cuerpo.html"
  printf '%s\n' '</body></html>'
} > "$PAGE"

"$CHROME" --headless=new --disable-gpu --no-first-run \
  --user-data-dir="$WORK/chrome" --no-pdf-header-footer \
  --print-to-pdf="$OUTPUT" "file://$PAGE" 2>/dev/null

echo "PDF generado: $OUTPUT"
