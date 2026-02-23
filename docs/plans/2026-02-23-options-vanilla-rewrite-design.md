# Options Page Vanilla Rewrite

## Goal

Replace the React/Vite options page with vanilla HTML/CSS/JS. Eliminate the build step, `node_modules` (70MB), and 112-package lockfile while preserving identical UI and behavior.

## Architecture

Three static files in `extension-options-page/`, no build step:

| File | Role |
|------|------|
| `index.html` | Static markup. External `<script src="options.js" defer>` and `<link>` to `options.css`. No inline JS or handlers. |
| `options.css` | Merged `App.css` + `index.css`. Same dark theme, same classes. Drop `-moz-range-thumb` (Chrome-only). |
| `options.js` | `DOMContentLoaded` handler. Loads settings from `chrome.storage.sync`, populates DOM, attaches event listeners. |

## Data Flow (unchanged)

```
page load -> chrome.storage.sync.get() -> populate DOM
user interaction -> update DOM + chrome.storage.sync.set()
cache buttons -> chrome.runtime.sendMessage() -> refresh count display
```

## Implementation Guardrails

1. Load JS as external with `defer`, no inline handlers anywhere.
2. Preserve storage keys/defaults exactly: `translationProvider` (`google`), `*ApiKey`, `targetLanguage` (`EN-US`), `subtitleFontSize` (`medium`).
3. Save current API key on provider change (not just blur) to avoid losing edits.
4. Use `textContent`/`createElement` for generated provider/language options. No `innerHTML` with dynamic values.
5. Keep a short project-specific `README.md`.
6. Update stale references in root `README.md` after migration.

## Files Changed Outside Options Page

- `manifest.json`: `options_page` -> `extension-options-page/index.html`
- `package_project.sh`: replace `extension-options-page/dist/` with `extension-options-page/index.html`, `extension-options-page/options.css`, `extension-options-page/options.js`

## Files Deleted

Everything in `extension-options-page/` except `index.html`, `options.css`, `options.js`, `README.md`:
- `src/` (App.jsx, App.css, main.jsx, index.css)
- `dist/` (built artifacts)
- `node_modules/`
- `package.json`, `package-lock.json`
- `vite.config.js`
- `.gitignore`

## Risk

Low. The page is pure forms with no complex interactions. All state management is direct `chrome.storage.sync` calls. The only dynamic UI is showing/hiding the API key section on provider change.
