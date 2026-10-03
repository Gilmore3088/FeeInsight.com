#!/bin/zsh
# Studio renderer: out/<id>.html -> out/<Institution>-fee-position.pdf via headless Chrome.
# Usage: ./render.sh <institution_id> [output-name]
set -euo pipefail
DIR="${0:a:h}"
ID="$1"
NAME="${2:-report-$ID}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$CHROME" ] || CHROME="$(command -v chromium || command -v google-chrome)"

node "$DIR/narrate.mjs" "$ID"
node "$DIR/fill.mjs" "$ID"
"$CHROME" --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="$DIR/out/$NAME.pdf" "file://$DIR/out/$ID.html" 2>/dev/null
echo "$DIR/out/$NAME.pdf"
