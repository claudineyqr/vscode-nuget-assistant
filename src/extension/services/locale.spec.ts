import { resolveAppLocale } from './locale';

describe('resolveAppLocale', () => {
  it.each([
    ['auto', 'en-US', 'en-US'],
    ['auto', 'pt', 'pt-BR'],
    ['auto', 'pt-PT', 'pt-BR'],
    ['auto', 'zh', 'zh-CN'],
    ['auto', 'zh-TW', 'zh-CN'],
    ['auto', 'fr-FR', 'en-US'],
    ['en', 'pt-BR', 'en-US'],
    ['pt-BR', 'en-US', 'pt-BR'],
    ['zh-CN', 'en-US', 'zh-CN'],
  ])('maps preference %s and IDE language %s to %s', (preference, ideLanguage, expected) => {
    expect(resolveAppLocale(preference, ideLanguage)).toBe(expected);
  });
});
