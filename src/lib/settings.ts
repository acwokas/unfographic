import { AppSettings } from '@/types/layout';

const STORAGE_KEY = 'slide-deconstructor-settings';

const defaultSettings: AppSettings = {
  provider: 'openai',
  apiKey: '',
  useCustomApiKey: false,
  model: 'gpt-4o',
  slideSize: '16:9',
};

export function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return { ...defaultSettings, ...JSON.parse(stored) };
    }
  } catch {}
  return defaultSettings;
}

export function saveSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function getModelsForProvider(provider: AppSettings['provider']): string[] {
  switch (provider) {
    case 'openai':
      return ['gpt-4o', 'gpt-4o-mini'];
    case 'anthropic':
      return ['claude-sonnet-4-20250514', 'claude-opus-4-0-20250115'];
    case 'openrouter':
      return [];
    default:
      return [];
  }
}
