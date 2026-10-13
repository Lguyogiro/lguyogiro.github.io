#!/usr/bin/env bash
# Copy the servable files of the web apps that live in their own folders into this site, so
# GitHub Pages serves them at
#   https://lguyogiro.github.io/multilingual_literacy_tool/
#   https://lguyogiro.github.io/learnfrench/
# The apps are developed in their own folders; run this after changing them, then commit here.
#
#   scripts/publish-apps.sh                 both apps
#   scripts/publish-apps.sh literacy        only the literacy tool
#   scripts/publish-apps.sh french          only learnfrench
#   scripts/publish-apps.sh --with-models   also copy the literacy tool's speech models (~80 MB),
#                                           which turn on spoken math answers
#
# Source folders can be changed with LITERACY_SRC and FRENCH_SRC.
set -euo pipefail

SITE="$(cd "$(dirname "$0")/.." && pwd)"
REPOS="$(dirname "$SITE")"
LITERACY_SRC="${LITERACY_SRC:-$REPOS/multilingual_literacy_tool}"
FRENCH_SRC="${FRENCH_SRC:-$REPOS/learnfrench/web}"

with_models=0
apps=()
for arg in "$@"; do
  case "$arg" in
    --with-models) with_models=1 ;;
    literacy|french) apps+=("$arg") ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done
[ ${#apps[@]} -eq 0 ] && apps=(literacy french)

publish_literacy() {
  local dest="$SITE/multilingual_literacy_tool"
  echo "literacy tool: $LITERACY_SRC → $dest"
  # Plain HTML/CSS/JS with no build step: copy what the page loads, nothing else
  # (no tests, docs, training tools or editor files).
  local include=(--include=/index.html --include=/manifest.webmanifest --include=/sw.js --include=/audio.txt
    --include=/css/*** --include=/js/*** --include=/corpus/*** --include=/icons/***)
  [ -d "$LITERACY_SRC/audio" ] && include+=(--include=/audio/***)
  [ "$with_models" = 1 ] && include+=(--include=/models/*** --exclude=/models/*/runs/***)
  rsync -a --delete --delete-excluded "${include[@]}" --exclude='*' "$LITERACY_SRC/" "$dest/"
}

publish_french() {
  local dest="$SITE/learnfrench"
  echo "learnfrench: building $FRENCH_SRC for /learnfrench/ → $dest"
  # Vite app: build it with the sub-path as its base, so asset and audio URLs point under
  # /learnfrench/. The build goes straight to the site; the app's own dist/ is not touched.
  ( cd "$FRENCH_SRC" && npm run build -- --base=/learnfrench/ --outDir="$dest" --emptyOutDir )
}

for app in "${apps[@]}"; do
  case "$app" in
    literacy) publish_literacy ;;
    french) publish_french ;;
  esac
done

# Files over GitHub's 100 MB limit can't be pushed.
big="$(find "$SITE/multilingual_literacy_tool" "$SITE/learnfrench" -type f -size +95M 2>/dev/null || true)"
if [ -n "$big" ]; then echo "warning: files too big for GitHub:" >&2; echo "$big" >&2; fi
du -sh "$SITE/multilingual_literacy_tool" "$SITE/learnfrench" 2>/dev/null || true
echo "done. Review with: git -C \"$SITE\" status"
