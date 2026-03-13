VERSION="$(node -p "require('./manifest.json').version")"
OUTPUT_FILE="yle-dual-sub-extension.zip"
VERSIONED_FILE="yle-dual-sub-extension_${VERSION}.zip"

rm -f "$OUTPUT_FILE" "$VERSIONED_FILE"

zip -r "$OUTPUT_FILE" \
  manifest.json \
  icons/icon.png \
  background.js \
  contentscript.js \
  content/settings.js \
  content/translation-api.js \
  content/translation-queue.js \
  content/word-translation.js \
  content/subtitle-dom.js \
  content/ui-events.js \
  content/runtime-messages.js \
  database.js \
  utils.js \
  inject.js \
  styles.css \
  popup.html \
  popup.js \
  controls/control-icons.js \
  controls/control-actions.js \
  controls/control-keyboard.js \
  controls/audio-filters.js \
  controls/audio-encoder.js \
  controls/screen-recorder.js \
  controls/control-panel.js \
  controls/control-integration.js \
  platforms/yle/yle-injected.js \
  lib/mp3-encoder.js \
  extension-options-page/index.html \
  extension-options-page/options.css \
  extension-options-page/options.js \
  -x "*.map" "*.DS_Store" "__MACOSX/*" "* 2.*"

cp "$OUTPUT_FILE" "$VERSIONED_FILE"
echo "Created $OUTPUT_FILE and $VERSIONED_FILE"
