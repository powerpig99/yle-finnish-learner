const DEFAULT_TARGET_LANGUAGE = 'EN-US';
const DEFAULT_FONT_SIZE = 'medium';
const DEFAULT_PROVIDER = 'google';

const PROVIDERS = [
  { id: 'google', name: 'Google Translate', description: 'Free, no API key needed' },
  { id: 'googleCloud', name: 'Google Cloud (API Key)', description: 'Paid - usage charges apply', link: 'https://console.cloud.google.com/apis/library/translate.googleapis.com' },
  { id: 'deepl', name: 'DeepL', description: 'Best for Finnish', link: 'https://www.deepl.com/en/your-account/keys' },
  { id: 'claude', name: 'Claude (Anthropic)', description: 'High quality AI', link: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', name: 'Gemini (Google AI)', description: "Google's AI model", link: 'https://aistudio.google.com/apikey' },
  { id: 'grok', name: 'Grok (xAI)', description: "xAI's model", link: 'https://console.x.ai' },
  { id: 'kimi', name: 'Kimi', description: 'Kimi 2.5 for Kimi Coding', link: 'https://platform.moonshot.ai' },
];

const FONT_SIZES = [
  { value: 'small', label: 'S', tooltip: 'Small (24px/20px)' },
  { value: 'medium', label: 'M', tooltip: 'Medium (32px/28px)' },
  { value: 'large', label: 'L', tooltip: 'Large (40px/36px)' },
  { value: 'xlarge', label: 'XL', tooltip: 'Extra Large (48px/42px)' },
  { value: 'xxlarge', label: '2K', tooltip: '2K Display (56px/50px)' },
  { value: 'huge', label: '4K', tooltip: '4K Display (64px/56px)' },
];

const LANGUAGES = [
  { code: 'EN-US', name: 'English (US)' },
  { code: 'EN-GB', name: 'English (UK)' },
  { code: 'VI', name: 'Vietnamese' },
  { code: 'AR', name: 'Arabic' },
  { code: 'BG', name: 'Bulgarian' },
  { code: 'CS', name: 'Czech' },
  { code: 'DA', name: 'Danish' },
  { code: 'DE', name: 'German' },
  { code: 'EL', name: 'Greek' },
  { code: 'ES', name: 'Spanish' },
  { code: 'ES-419', name: 'Spanish (Latin American)' },
  { code: 'ET', name: 'Estonian' },
  { code: 'FI', name: 'Finnish' },
  { code: 'FR', name: 'French' },
  { code: 'HU', name: 'Hungarian' },
  { code: 'ID', name: 'Indonesian' },
  { code: 'IT', name: 'Italian' },
  { code: 'JA', name: 'Japanese' },
  { code: 'KO', name: 'Korean' },
  { code: 'LT', name: 'Lithuanian' },
  { code: 'LV', name: 'Latvian' },
  { code: 'NB', name: 'Norwegian (Bokmål)' },
  { code: 'NL', name: 'Dutch' },
  { code: 'PL', name: 'Polish' },
  { code: 'PT-BR', name: 'Portuguese (Brazilian)' },
  { code: 'PT-PT', name: 'Portuguese (European)' },
  { code: 'RO', name: 'Romanian' },
  { code: 'RU', name: 'Russian' },
  { code: 'SK', name: 'Slovak' },
  { code: 'SL', name: 'Slovenian' },
  { code: 'SV', name: 'Swedish' },
  { code: 'TR', name: 'Turkish' },
  { code: 'UK', name: 'Ukrainian' },
  { code: 'ZH-HANS', name: 'Chinese (Simplified)' },
  { code: 'ZH-HANT', name: 'Chinese (Traditional)' },
];

const STORAGE_KEYS = [
  'translationProvider',
  'googleCloudApiKey',
  'deeplApiKey',
  'claudeApiKey',
  'geminiApiKey',
  'grokApiKey',
  'kimiApiKey',
  'targetLanguage',
  'subtitleFontSize',
];

const state = {
  translationProvider: DEFAULT_PROVIDER,
  /**
   * Provider-specific API key state.
   * Keep provider->key mapping in sync with:
   * - background.js (loadProviderConfig apiKeyMap)
   * - content/settings.js (checkHasValidProvider keyMap)
   */
  apiKeys: {
    googleCloud: '',
    deepl: '',
    claude: '',
    gemini: '',
    grok: '',
    kimi: '',
  },
  targetLanguage: DEFAULT_TARGET_LANGUAGE,
  subtitleFontSize: DEFAULT_FONT_SIZE,
  cacheCounts: {
    wordCount: 0,
    subtitleCount: 0,
  },
};

const dom = {
  providerList: null,
  apiKeySection: null,
  apiKeyInput: null,
  apiKeyLink: null,
  languageSelect: null,
  sizeSlider: null,
  sliderValue: null,
  clearWordCacheButton: null,
  clearSubtitleCacheButton: null,
  wordCacheCount: null,
  subtitleCacheCount: null,
};

function getProviderById(providerId) {
  return PROVIDERS.find((provider) => provider.id === providerId) || null;
}

function updateProviderSelection() {
  const radios = dom.providerList.querySelectorAll('input[type="radio"][name="provider"]');
  for (const radio of radios) {
    radio.checked = radio.value === state.translationProvider;
  }
}

function updateApiKeySection() {
  const provider = getProviderById(state.translationProvider);
  const needsApiKey = state.translationProvider !== 'google';

  dom.apiKeySection.classList.toggle('hidden', !needsApiKey);
  if (!needsApiKey || !provider) {
    return;
  }

  const currentApiKey = state.apiKeys[state.translationProvider] || '';
  dom.apiKeyInput.value = currentApiKey;
  dom.apiKeyInput.placeholder = `Enter ${provider.name} API key`;

  if (provider.link) {
    dom.apiKeyLink.classList.remove('hidden');
    dom.apiKeyLink.href = provider.link;
  } else {
    dom.apiKeyLink.classList.add('hidden');
    dom.apiKeyLink.removeAttribute('href');
  }
}

function updateSliderValue() {
  const index = FONT_SIZES.findIndex((item) => item.value === state.subtitleFontSize);
  const safeIndex = index >= 0 ? index : 1;
  dom.sizeSlider.value = String(safeIndex);
  dom.sliderValue.textContent = FONT_SIZES[safeIndex].tooltip;
}

function buildProviderList() {
  const fragment = document.createDocumentFragment();

  for (const provider of PROVIDERS) {
    const label = document.createElement('label');
    label.className = 'provider-option';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'provider';
    radio.value = provider.id;

    const name = document.createElement('span');
    name.className = 'provider-name';
    name.textContent = provider.name;

    const description = document.createElement('span');
    description.className = 'provider-desc';
    description.textContent = provider.description;

    label.append(radio, name, description);
    fragment.appendChild(label);
  }

  dom.providerList.textContent = '';
  dom.providerList.appendChild(fragment);
}

function buildLanguageSelect() {
  const fragment = document.createDocumentFragment();

  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.name;
    fragment.appendChild(option);
  }

  dom.languageSelect.textContent = '';
  dom.languageSelect.appendChild(fragment);
}

async function refreshCacheCounts() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getCacheCounts' });
    if (response && response.success) {
      state.cacheCounts.wordCount = response.wordCount || 0;
      state.cacheCounts.subtitleCount = response.subtitleCount || 0;
      dom.wordCacheCount.textContent = `${state.cacheCounts.wordCount} entries`;
      dom.subtitleCacheCount.textContent = `${state.cacheCounts.subtitleCount} entries`;
    }
  } catch (error) {
    console.error('Failed to get cache counts:', error);
  }
}

async function saveApiKey(providerId, apiKey) {
  if (providerId === 'google') {
    return;
  }

  const keyName = `${providerId}ApiKey`;
  try {
    await chrome.storage.sync.set({ [keyName]: apiKey });
  } catch (error) {
    console.error('Failed to save API key:', error);
  }
}

async function clearCacheAndRefresh(action) {
  try {
    const response = await chrome.runtime.sendMessage({ action });
    if (response && response.success) {
      await refreshCacheCounts();
    } else {
      alert(`Failed to clear: ${response && response.error ? response.error : 'Unknown error'}`);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
}

function attachEventListeners() {
  dom.providerList.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.type !== 'radio' || target.name !== 'provider') {
      return;
    }

    const nextProvider = target.value;
    if (!nextProvider || nextProvider === state.translationProvider) {
      return;
    }

    const previousProvider = state.translationProvider;
    if (previousProvider !== 'google') {
      const currentInputValue = dom.apiKeyInput.value;
      state.apiKeys[previousProvider] = currentInputValue;
      await saveApiKey(previousProvider, currentInputValue);
    }

    state.translationProvider = nextProvider;
    updateApiKeySection();

    chrome.storage.sync
      .set({ translationProvider: nextProvider })
      .catch((error) => console.error('Failed to save provider:', error));
  });

  dom.apiKeyInput.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    state.apiKeys[state.translationProvider] = target.value;
  });

  dom.apiKeyInput.addEventListener('blur', async () => {
    await saveApiKey(state.translationProvider, dom.apiKeyInput.value);
  });

  dom.languageSelect.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const languageCode = target.value;
    state.targetLanguage = languageCode;

    chrome.storage.sync
      .set({ targetLanguage: languageCode })
      .catch((error) => console.error('Failed to save target language:', error));
  });

  dom.sizeSlider.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    const index = Number.parseInt(target.value, 10);
    if (!Number.isFinite(index) || index < 0 || index >= FONT_SIZES.length) {
      return;
    }

    const selectedFontSize = FONT_SIZES[index].value;
    state.subtitleFontSize = selectedFontSize;
    updateSliderValue();

    chrome.storage.sync
      .set({ subtitleFontSize: selectedFontSize })
      .catch((error) => console.error('Failed to save subtitle font size:', error));
  });

  dom.clearWordCacheButton.addEventListener('click', () => {
    clearCacheAndRefresh('clearWordCache');
  });

  dom.clearSubtitleCacheButton.addEventListener('click', () => {
    clearCacheAndRefresh('clearSubtitleCaches');
  });
}

async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get(STORAGE_KEYS);

    if (typeof result.translationProvider === 'string' && getProviderById(result.translationProvider)) {
      state.translationProvider = result.translationProvider;
    }

    state.apiKeys = {
      googleCloud: typeof result.googleCloudApiKey === 'string' ? result.googleCloudApiKey : '',
      deepl: typeof result.deeplApiKey === 'string' ? result.deeplApiKey : '',
      claude: typeof result.claudeApiKey === 'string' ? result.claudeApiKey : '',
      gemini: typeof result.geminiApiKey === 'string' ? result.geminiApiKey : '',
      grok: typeof result.grokApiKey === 'string' ? result.grokApiKey : '',
      kimi: typeof result.kimiApiKey === 'string' ? result.kimiApiKey : '',
    };

    if (
      typeof result.targetLanguage === 'string' &&
      result.targetLanguage.length > 0 &&
      LANGUAGES.some((lang) => lang.code === result.targetLanguage)
    ) {
      state.targetLanguage = result.targetLanguage;
    }

    if (typeof result.subtitleFontSize === 'string' && FONT_SIZES.some((size) => size.value === result.subtitleFontSize)) {
      state.subtitleFontSize = result.subtitleFontSize;
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }

  updateProviderSelection();
  updateApiKeySection();
  dom.languageSelect.value = state.targetLanguage;
  updateSliderValue();
}

function cacheDomReferences() {
  dom.providerList = document.getElementById('provider-list');
  dom.apiKeySection = document.getElementById('api-key-section');
  dom.apiKeyInput = document.getElementById('api-key-input');
  dom.apiKeyLink = document.getElementById('api-key-link');
  dom.languageSelect = document.getElementById('language-select');
  dom.sizeSlider = document.getElementById('size-slider');
  dom.sliderValue = document.getElementById('slider-value');
  dom.clearWordCacheButton = document.getElementById('clear-word-cache');
  dom.clearSubtitleCacheButton = document.getElementById('clear-subtitle-cache');
  dom.wordCacheCount = document.getElementById('word-cache-count');
  dom.subtitleCacheCount = document.getElementById('subtitle-cache-count');

  for (const [key, value] of Object.entries(dom)) {
    if (!value) {
      throw new Error(`Missing required DOM element: ${key}`);
    }
  }
}

async function initializeOptionsPage() {
  cacheDomReferences();
  buildProviderList();
  buildLanguageSelect();
  attachEventListeners();
  await loadSettings();
  await refreshCacheCounts();
}

document.addEventListener('DOMContentLoaded', () => {
  initializeOptionsPage().catch((error) => {
    console.error('Failed to initialize options page:', error);
  });
});
