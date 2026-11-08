import source from './messages.en.json';
import portuguese from './messages.pt-BR.json';
import chinese from './messages.zh-CN.json';

describe('Angular runtime translations', () => {
  const sourceMessages = source.translations;

  it('uses readable semantic message IDs', () => {
    const messageIds = Object.keys(sourceMessages);

    expect(messageIds.length).toBeGreaterThan(0);
    expect(messageIds.every((messageId) => /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/.test(messageId))).toBe(true);
    expect(messageIds).toContain('packageDetails.license.label');
  });

  it('keeps the product name unchanged in every locale', () => {
    const brandId = 'navigation.projectTitle';
    expect(sourceMessages[brandId]).toContain('NuGet Assistant');
    expect((portuguese as Record<string, string>)[brandId]).toContain('NuGet Assistant');
    expect((chinese as Record<string, string>)[brandId]).toContain('NuGet Assistant');
  });

  it.each([
    ['pt-BR', portuguese as Record<string, string>],
    ['zh-CN', chinese as Record<string, string>],
  ])('provides a complete %s catalog with matching placeholders', (_locale, translations) => {
    expect(Object.keys(translations).sort()).toEqual(Object.keys(sourceMessages).sort());

    for (const [messageId, sourceMessage] of Object.entries(sourceMessages)) {
      expect(placeholders(translations[messageId])).toEqual(placeholders(sourceMessage));
    }
  });
});

function placeholders(message: string): string[] {
  return Array.from(message.matchAll(/\{\$([^}]+)\}/g), (match) => match[1]).sort();
}
