import * as vscode from 'vscode';
import english from '../../../package.nls.json';
import portuguese from '../../../package.nls.pt-br.json';
import chinese from '../../../package.nls.zh-cn.json';
import { resolveAppLocale } from './locale';

type MessageKey = keyof typeof english;

const catalogs: Record<string, Partial<Record<MessageKey, string>>> = {
  'en-US': english,
  'pt-BR': portuguese,
  'zh-CN': chinese,
};

export function localize(key: MessageKey, ...args: Array<string | number | boolean>): string {
  const extensionConfig = vscode.workspace.getConfiguration?.('nuget-assistant');
  const languagePreference = extensionConfig?.get<string>('language', 'auto') ?? 'auto';
  const locale = resolveAppLocale(languagePreference, vscode.env?.language ?? 'en');
  const template = catalogs[locale][key] ?? english[key];

  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}
