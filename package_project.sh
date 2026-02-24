rm -f yle-dual-sub-extension.zip

zip -r yle-dual-sub-extension.zip \
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
  controls/audio-recorder.js \
  controls/screen-recorder.js \
  controls/audio-download-ui.js \
  controls/control-panel.js \
  controls/control-integration.js \
  platforms/yle/yle-injected.js \
  lib/lamejs.min.js \
  extension-options-page/index.html \
  extension-options-page/options.css \
  extension-options-page/options.js \
  -x "*.map" "*.DS_Store" "__MACOSX/*" "* 2.*"
