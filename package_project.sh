rm -f yle-dual-sub-extension.zip

zip -r yle-dual-sub-extension.zip \
  manifest.json \
  icons/ \
  dist/ \
  database.js \
  utils.js \
  types.js \
  inject.js \
  styles.css \
  popup.html \
  popup.js \
  controls/ \
  platforms/yle/yle-injected.js \
  lib/ \
  extension-options-page/index.html \
  extension-options-page/options.css \
  extension-options-page/options.js \
  -x "*.map" "*.DS_Store" "__MACOSX/*" "* 2.*"
