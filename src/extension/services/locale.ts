export type AppLocale = 'en-US' | 'pt-BR' | 'zh-CN';

export function resolveAppLocale(preference: string, ideLanguage: string): AppLocale {
  if (preference === 'en' || preference === 'pt-BR' || preference === 'zh-CN') {
    return preference === 'en' ? 'en-US' : preference;
  }

  const language = ideLanguage.toLowerCase();
  if (language === 'pt' || language.startsWith('pt-')) {
    return 'pt-BR';
  }
  if (language === 'zh' || language.startsWith('zh-')) {
    return 'zh-CN';
  }
  return 'en-US';
}
