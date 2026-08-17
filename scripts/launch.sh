#!/bin/zsh
# Launch at normal priority. A plain `npm start` from an agent shell inherits
# nice 5 and the renderer throttles; `open` avoids that.
cd "$(dirname "$0")/.."
exec open -na "$(pwd)/node_modules/electron/dist/Electron.app" --args "$(pwd)"
