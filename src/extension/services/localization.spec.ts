import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import english from '../../../package.nls.json';
import portuguese from '../../../package.nls.pt-br.json';
import chinese from '../../../package.nls.zh-cn.json';
import { localize } from './localization';

jest.mock('vscode', () => ({
  env: { language: 'en-US' },
  workspace: {
    getConfiguration: jest.fn(() => ({ get: jest.fn(() => 'auto') })),
  },
}));

describe('extension localization', () => {
  const getLanguagePreference = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({ get: getLanguagePreference });
  });

  it.each([
    ['en-US', 'Error loading project: XML parser detail'],
    ['pt-BR', 'Erro ao carregar o projeto: XML parser detail'],
    ['zh-CN', '加载项目时出错：XML parser detail'],
  ])('selects the %s catalog and inserts error details unchanged', (language, expectedMessage) => {
    (vscode.env as { language: string }).language = language;
    getLanguagePreference.mockReturnValue('auto');

    expect(localize('error.loadProject', 'XML parser detail')).toBe(expectedMessage);
  });

  it('uses an explicit language preference instead of the IDE language', () => {
    (vscode.env as { language: string }).language = 'en-US';
    getLanguagePreference.mockReturnValue('zh-CN');

    expect(localize('error.loadProject', 'details')).toBe('加载项目时出错：details');
  });

  it('falls back to the English catalog when the IDE language is unsupported', () => {
    (vscode.env as { language: string }).language = 'fr-FR';
    getLanguagePreference.mockReturnValue('auto');

    expect(localize('error.loadProject', 'details')).toBe('Error loading project: details');
  });

  it('keeps all manifest translation keys present in each locale catalog', () => {
    const englishKeys = Object.keys(english).sort();
    expect(Object.keys(portuguese).sort()).toEqual(englishKeys);
    expect(Object.keys(chinese).sort()).toEqual(englishKeys);

    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as unknown;
    const manifestKeys = Array.from(JSON.stringify(manifest).matchAll(/%([^%]+)%/g), (match) => match[1]);
    expect(manifestKeys.every((key) => Object.prototype.hasOwnProperty.call(english, key))).toBe(true);

    for (const key of englishKeys) {
      const placeholders = (message: string): string[] => Array.from(message.matchAll(/\{(\d+)\}/g), (match) => match[1]).sort();
      expect(placeholders(portuguese[key as keyof typeof portuguese])).toEqual(placeholders(english[key as keyof typeof english]));
      expect(placeholders(chinese[key as keyof typeof chinese])).toEqual(placeholders(english[key as keyof typeof english]));
    }
  });

  it.each([
    ['en-US', 'The project file contains invalid XML: parser detail'],
    ['pt-BR', 'O arquivo de projeto contém XML inválido: parser detail'],
    ['zh-CN', '项目文件包含无效的 XML：parser detail'],
  ])('localizes extension-authored parsing errors in %s and preserves external detail', (language, expectedMessage) => {
    (vscode.env as { language: string }).language = language;
    getLanguagePreference.mockReturnValue('auto');

    expect(localize('error.invalidProjectXml', 'parser detail')).toBe(expectedMessage);
  });
});
