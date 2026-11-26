import * as fs from 'node:fs';
import * as path from 'node:path';
import * as xml2js from 'xml2js';
import {
  NuGetConfigSnapshot,
  NuGetConfigSource,
  NuGetConfigSourceUpdate,
} from '../../shared/models/nuget-config';
import { formatErrorMessage } from '../../shared/utils/error-message';
import { NuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';
import {
  isValidNuGetConfigCredentialValue,
  isValidNuGetConfigSourceName,
  isValidNuGetConfigSourceUrl,
} from '../../shared/utils/nuget-config-validation';
import { localize } from './localization';
import NuGetConfigLoader, { NuGetConfigFileCandidate } from './nuget-config-loader';
import { isRecord } from './security-validation';

type XmlAttributes = Record<string, string>;
type XmlEntry = { $?: XmlAttributes };

interface SourceSection {
  clear: boolean;
  remove: XmlEntry[];
  add: XmlEntry[];
}

interface CredentialSection {
  encodedName: string;
  decodedName: string;
  add: XmlEntry[];
}

interface SectionMatch {
  start: number;
  end: number;
  openingTag: string;
  inner: string;
  baseIndent: string;
}

interface ParsedConfig {
  packageSources: SourceSection;
  disabledPackageSources: SourceSection;
  packageSourceCredentials: CredentialSection[];
  sections: {
    packageSources?: SectionMatch;
    disabledPackageSources?: SectionMatch;
    packageSourceCredentials?: SectionMatch;
  };
}

export default class NuGetConfigEditor {
  public constructor(private readonly loader: NuGetConfigLoader = new NuGetConfigLoader()) {}

  public async loadAsync(projectFilePath?: string, filePath?: string): Promise<NuGetConfigSnapshot> {
    const candidates = await this.loader.getConfigFileCandidatesAsync(projectFilePath);
    const selected = this.selectCandidate(candidates, filePath);
    if (!selected) {
      throw new Error(localize('error.nugetConfigFileNotAllowed'));
    }

    const exists = await this.fileExists(selected.path);
    const sources = exists ? await this.readSourcesAsync(selected.path) : [];
    return {
      files: candidates.map((candidate) => ({
        path: candidate.path,
        kind: candidate.kind,
        exists: candidate.exists,
      })),
      selectedFilePath: selected.path,
      fileExists: exists,
      sources,
    };
  }

  public async saveAsync(projectFilePath: string | undefined, filePath: unknown, updates: unknown): Promise<NuGetConfigSnapshot> {
    const candidates = await this.loader.getConfigFileCandidatesAsync(projectFilePath);
    const selected = typeof filePath === 'string' ? this.selectCandidate(candidates, filePath) : undefined;
    if (!selected) {
      throw new Error(localize('error.nugetConfigFileNotAllowed'));
    }

    const validatedUpdates = await this.validateUpdatesAsync(selected.path, updates);
    const existingText = await this.readTextAsync(selected.path);
    const baseText = existingText?.trim() ? existingText : defaultConfigText();
    const parsed = await parseConfigText(baseText, selected.path);
    const updatedText = this.applyUpdates(baseText, parsed, validatedUpdates);
    await this.writeTextAsync(selected.path, updatedText);
    return this.loadAsync(projectFilePath, selected.path);
  }

  private selectCandidate(
    candidates: NuGetConfigFileCandidate[],
    filePath: string | undefined
  ): NuGetConfigFileCandidate | undefined {
    if (filePath === undefined || filePath.length === 0) {
      return candidates[0];
    }
    const normalized = normalizePath(filePath);
    return candidates.find((candidate) => normalizePath(candidate.path) === normalized);
  }

  private async readSourcesAsync(filePath: string): Promise<NuGetConfigSource[]> {
    const text = await this.readTextAsync(filePath);
    if (!text?.trim()) {
      return [];
    }

    const parsed = await parseConfigText(text, filePath);
    const sources = new Map<string, NuGetConfigSource>();
    for (const entry of parsed.packageSources.add) {
      const name = entry.$?.['key'];
      const url = entry.$?.['value'];
      if (!name || !url) {
        continue;
      }
      sources.set(normalizeSourceName(name), {
        name,
        url,
        enabled: true,
        hasPassword: false,
      });
    }

    const disabled = new Map<string, boolean>();
    for (const entry of parsed.disabledPackageSources.add) {
      const name = entry.$?.['key'];
      const value = entry.$?.['value']?.trim().toLowerCase();
      if (name) {
        disabled.set(normalizeSourceName(name), value === 'true');
      }
    }

    const credentials = new Map<string, { username?: string; hasPassword: boolean }>();
    for (const section of parsed.packageSourceCredentials) {
      const usernameEntry = section.add.find((entry) => entry.$?.['key']?.toLowerCase() === 'username');
      const passwordEntry = section.add.find((entry) => entry.$?.['key']?.toLowerCase() === 'cleartextpassword');
      credentials.set(normalizeSourceName(section.decodedName), {
        username: usernameEntry?.$?.['value'],
        hasPassword: passwordEntry !== undefined,
      });
    }

    return Array.from(sources.entries()).map(([key, source]) => {
      const credential = credentials.get(key);
      return {
        ...source,
        enabled: !disabled.get(key),
        username: credential?.username,
        hasPassword: credential?.hasPassword ?? false,
      };
    });
  }

  private async validateUpdatesAsync(filePath: string, updates: unknown): Promise<NuGetConfigSourceUpdate[]> {
    if (!Array.isArray(updates) || updates.length > 500) {
      throw new Error(localize('error.nugetConfigInvalidData'));
    }

    const text = await this.readTextAsync(filePath);
    const baseText = text?.trim() ? text : defaultConfigText();
    const parsed = await parseConfigText(baseText, filePath);
    const existingSourceNames = new Set(
      parsed.packageSources.add
        .map((entry) => entry.$?.['key'])
        .filter((name): name is string => typeof name === 'string')
        .map(normalizeSourceName)
    );
    const existingCredentials = new Map<string, CredentialSection>();
    for (const section of parsed.packageSourceCredentials) {
      existingCredentials.set(normalizeSourceName(section.decodedName), section);
    }

    const names = new Set<string>();
    const result: NuGetConfigSourceUpdate[] = [];
    for (const value of updates) {
      if (!isRecord(value)) {
        throw new Error(localize('error.nugetConfigInvalidData'));
      }

      const name = typeof value['name'] === 'string' ? value['name'].trim() : '';
      const url = typeof value['url'] === 'string' ? value['url'].trim() : '';
      const enabled = value['enabled'];
      if (!isValidNuGetConfigSourceName(name)) {
        throw new Error(localize('error.nugetConfigSourceName', name));
      }
      if (!isValidNuGetConfigSourceUrl(url)) {
        throw new Error(localize('error.nugetConfigSourceUrl', name));
      }
      if (typeof enabled !== 'boolean') {
        throw new Error(localize('error.nugetConfigInvalidData'));
      }

      const normalizedName = normalizeSourceName(name);
      if (names.has(normalizedName)) {
        throw new Error(localize('error.nugetConfigDuplicateSource', name));
      }
      names.add(normalizedName);

      let originalName: string | undefined;
      if (value['originalName'] !== undefined) {
        const candidate = typeof value['originalName'] === 'string' ? value['originalName'].trim() : '';
        if (!isValidNuGetConfigSourceName(candidate)) {
          throw new Error(localize('error.nugetConfigSourceName', candidate));
        }
        if (!existingSourceNames.has(normalizeSourceName(candidate))) {
          throw new Error(localize('error.nugetConfigOriginalSourceNotFound', candidate));
        }
        originalName = candidate;
      }

      const credentialsValue = value['credentials'];
      let credentials: NuGetConfigSourceUpdate['credentials'];
      if (credentialsValue !== undefined) {
        if (!isRecord(credentialsValue)) {
          throw new Error(localize('error.nugetConfigInvalidData'));
        }
        const action = credentialsValue['action'];
        if (action !== 'keep' && action !== 'replace' && action !== 'remove') {
          throw new Error(localize('error.nugetConfigInvalidData'));
        }
        const usernameValue = credentialsValue['username'];
        const passwordValue = credentialsValue['password'];
        if (usernameValue !== undefined && !isValidNuGetConfigCredentialValue(usernameValue)) {
          throw new Error(localize('error.nugetConfigCredentials', name));
        }
        if (passwordValue !== undefined && !isValidNuGetConfigCredentialValue(passwordValue)) {
          throw new Error(localize('error.nugetConfigCredentials', name));
        }

        if (action === 'replace') {
          const username = typeof usernameValue === 'string' ? usernameValue.trim() : '';
          if (!username) {
            throw new Error(localize('error.nugetConfigCredentials', name));
          }
          if (passwordValue === undefined || passwordValue === '') {
            const existing = existingCredentials.get(normalizeSourceName(originalName ?? name)) ??
              existingCredentials.get(normalizedName);
            const hasExistingPassword = existing?.add.some(
              (entry) => entry.$?.['key']?.toLowerCase() === 'cleartextpassword'
            ) ?? false;
            if (!hasExistingPassword) {
              throw new Error(localize('error.nugetConfigCredentials', name));
            }
          }
          credentials = {
            action,
            username,
            password: typeof passwordValue === 'string' && passwordValue.length > 0 ? passwordValue : undefined,
          };
        } else {
          credentials = { action };
        }
      }

      result.push({ name, url, enabled, originalName, credentials });
    }
    return result;
  }

  private applyUpdates(text: string, parsed: ParsedConfig, updates: NuGetConfigSourceUpdate[]): string {
    const renderedSections = [
      { name: 'packageSources', children: renderSourceSection(parsed.packageSources, updates) },
      { name: 'disabledPackageSources', children: renderDisabledSection(parsed, updates) },
      { name: 'packageSourceCredentials', children: renderCredentialsSection(parsed, updates) },
    ];
    const sectionMatches = new Map<string, SectionMatch | undefined>([
      ['packageSources', parsed.sections.packageSources],
      ['disabledPackageSources', parsed.sections.disabledPackageSources],
      ['packageSourceCredentials', parsed.sections.packageSourceCredentials],
    ]);

    const replacements: Array<{ start: number; end: number; text: string }> = [];
    const insertions: Array<{ name: string; children: string[] }> = [];
    for (const section of renderedSections) {
      const match = sectionMatches.get(section.name);
      if (section.children.length === 0) {
        if (match) {
          const range = getRemovalRange(text, match);
          replacements.push({ start: range.start, end: range.end, text: '' });
        }
        continue;
      }
      if (match) {
        replacements.push({
          start: match.start,
          end: match.end,
          text: renderSectionElement(section.name, match.openingTag, section.children, match.baseIndent),
        });
      } else {
        insertions.push(section);
      }
    }

    let result = text;
    for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
      result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
    }
    if (insertions.length > 0) {
      const insertionText = insertions
        .map((section) => renderSectionElement(section.name, `<${section.name}>`, section.children, '  '))
        .join('\n');
      result = insertBeforeClosingConfiguration(result, insertionText);
    }
    return result;
  }

  private async readTextAsync(filePath: string): Promise<string | undefined> {
    try {
      return await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  private async writeTextAsync(filePath: string, text: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temporaryPath, text, 'utf8');
    try {
      await fs.promises.rename(temporaryPath, filePath);
    } catch (error) {
      try {
        await fs.promises.copyFile(temporaryPath, filePath);
        await fs.promises.rm(temporaryPath, { force: true });
      } catch {
        await fs.promises.rm(temporaryPath, { force: true });
        throw error;
      }
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}

async function parseConfigText(text: string, filePath: string): Promise<ParsedConfig> {
  if (!text.trim()) {
    return {
      packageSources: emptySourceSection(),
      disabledPackageSources: emptySourceSection(),
      packageSourceCredentials: [],
      sections: {},
    };
  }

  try {
    const parsed = (await xml2js.parseStringPromise(text)) as Record<string, unknown>;
    if (parsed['configuration'] === undefined) {
      throw new Error('Missing <configuration> root element.');
    }
  } catch (error) {
    throw new NuGetDataParsingError(localize('error.invalidNugetConfigXml', filePath, formatErrorMessage(error)));
  }

  try {
    const packageSourcesMatch = findSection(text, 'packageSources');
    const disabledSourcesMatch = findSection(text, 'disabledPackageSources');
    const credentialsMatch = findSection(text, 'packageSourceCredentials');
    return {
      packageSources: packageSourcesMatch ? await parseSourceSection(packageSourcesMatch.inner) : emptySourceSection(),
      disabledPackageSources: disabledSourcesMatch ? await parseSourceSection(disabledSourcesMatch.inner) : emptySourceSection(),
      packageSourceCredentials: credentialsMatch ? await parseCredentialsSection(credentialsMatch.inner) : [],
      sections: {
        packageSources: packageSourcesMatch,
        disabledPackageSources: disabledSourcesMatch,
        packageSourceCredentials: credentialsMatch,
      },
    };
  } catch (error) {
    throw new NuGetDataParsingError(localize('error.invalidNugetConfigXml', filePath, formatErrorMessage(error)));
  }
}

function emptySourceSection(): SourceSection {
  return { clear: false, remove: [], add: [] };
}

async function parseSourceSection(inner: string): Promise<SourceSection> {
  const root = await parseInnerXml(inner);
  return {
    clear: root['clear'] !== undefined,
    remove: asXmlEntries(root['remove']),
    add: asXmlEntries(root['add']),
  };
}

async function parseCredentialsSection(inner: string): Promise<CredentialSection[]> {
  const root = await parseInnerXml(inner);
  const credentials: CredentialSection[] = [];
  for (const [encodedName, value] of Object.entries(root)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const first = value[0];
    credentials.push({
      encodedName,
      decodedName: decodeXmlName(encodedName),
      add: isRecord(first) ? asXmlEntries(first['add']) : [],
    });
  }
  return credentials;
}

async function parseInnerXml(inner: string): Promise<Record<string, unknown>> {
  const parsed = (await xml2js.parseStringPromise(`<root>${inner}</root>`)) as { root?: Record<string, unknown> };
  return parsed.root ?? {};
}

function asXmlEntries(value: unknown): XmlEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is XmlEntry => isRecord(entry));
}

function findSection(text: string, name: string): SectionMatch | undefined {
  const paired = new RegExp(`<${name}(\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`, 'i').exec(text);
  if (paired) {
    const start = paired.index;
    return {
      start,
      end: start + paired[0].length,
      openingTag: `<${name}${paired[1] ?? ''}>`,
      inner: paired[2],
      baseIndent: getLineIndent(text, start),
    };
  }

  const selfClosing = new RegExp(`<${name}(\\s[^>]*)?\\s*/>`, 'i').exec(text);
  if (selfClosing) {
    const start = selfClosing.index;
    return {
      start,
      end: start + selfClosing[0].length,
      openingTag: `<${name}${selfClosing[1] ?? ''}>`,
      inner: '',
      baseIndent: getLineIndent(text, start),
    };
  }
  return undefined;
}

function getLineIndent(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', position) + 1;
  const leading = text.slice(lineStart, position);
  return /^\s*$/.test(leading) ? leading : '';
}

function getRemovalRange(text: string, match: SectionMatch): { start: number; end: number } {
  const lineStart = text.lastIndexOf('\n', match.start) + 1;
  const leading = text.slice(lineStart, match.start);
  if (leading.trim() !== '') {
    return { start: match.start, end: match.end };
  }
  let end = match.end;
  if (text[end] === '\r') {
    end++;
  }
  if (text[end] === '\n') {
    end++;
  }
  return { start: lineStart, end };
}

function renderSourceSection(section: SourceSection, updates: NuGetConfigSourceUpdate[]): string[] {
  const existingByKey = new Map<string, XmlEntry>();
  const unmatchedEntries: XmlEntry[] = [];
  for (const entry of section.add) {
    const key = entry.$?.['key'];
    const value = entry.$?.['value'];
    if (!key || value === undefined) {
      unmatchedEntries.push(entry);
      continue;
    }
    const update = findUpdate(updates, key);
    if (!update) {
      continue;
    }
    const updateKey = normalizeSourceName(update.name);
    if (existingByKey.has(updateKey)) {
      continue;
    }
    existingByKey.set(updateKey, { $: { ...(entry.$ ?? {}), key: update.name, value: update.url } });
  }

  // Emit entries in the order supplied by the UI so reordering is persisted.
  const adds: XmlEntry[] = [];
  for (const update of updates) {
    const updateKey = normalizeSourceName(update.name);
    const existing = existingByKey.get(updateKey);
    if (existing) {
      existingByKey.delete(updateKey);
      adds.push(existing);
    } else {
      adds.push({ $: { key: update.name, value: update.url } });
    }
  }
  adds.push(...unmatchedEntries);

  const children: string[] = [];
  if (section.clear) {
    children.push('<clear />');
  }
  for (const entry of section.remove) {
    children.push(renderRemoveEntry(entry));
  }
  for (const entry of adds) {
    children.push(renderAddEntry(entry));
  }
  return children;
}

function renderDisabledSection(parsed: ParsedConfig, updates: NuGetConfigSourceUpdate[]): string[] {
  const section = parsed.disabledPackageSources;
  const removedOwnSources = new Set<string>();
  for (const entry of parsed.packageSources.add) {
    const key = entry.$?.['key'];
    if (key && !findUpdate(updates, key)) {
      removedOwnSources.add(normalizeSourceName(key));
    }
  }

  const consumed = new Set<string>();
  const adds: XmlEntry[] = [];
  for (const entry of section.add) {
    const key = entry.$?.['key'];
    if (!key) {
      adds.push(entry);
      continue;
    }
    if (removedOwnSources.has(normalizeSourceName(key))) {
      continue;
    }
    const update = findUpdate(updates, key);
    if (!update) {
      adds.push(entry);
      continue;
    }
    const updateKey = normalizeSourceName(update.name);
    if (consumed.has(updateKey)) {
      continue;
    }
    consumed.add(updateKey);
    if (!update.enabled) {
      adds.push({ $: { ...(entry.$ ?? {}), key: update.name, value: 'true' } });
    }
  }
  for (const update of updates) {
    if (update.enabled) {
      continue;
    }
    const updateKey = normalizeSourceName(update.name);
    if (!consumed.has(updateKey)) {
      consumed.add(updateKey);
      adds.push({ $: { key: update.name, value: 'true' } });
    }
  }

  const children: string[] = [];
  if (section.clear) {
    children.push('<clear />');
  }
  for (const entry of section.remove) {
    children.push(renderRemoveEntry(entry));
  }
  for (const entry of adds) {
    children.push(renderAddEntry(entry));
  }
  return children;
}

function renderCredentialsSection(parsed: ParsedConfig, updates: NuGetConfigSourceUpdate[]): string[] {
  const removedOwnSources = new Set<string>();
  for (const entry of parsed.packageSources.add) {
    const key = entry.$?.['key'];
    if (key && !findUpdate(updates, key)) {
      removedOwnSources.add(normalizeSourceName(key));
    }
  }

  const rendered: Array<{ encodedName: string; add: XmlEntry[] }> = [];
  const handled = new Set<string>();
  for (const section of parsed.packageSourceCredentials) {
    const update = findUpdate(updates, section.decodedName);
    if (update) {
      const updateKey = normalizeSourceName(update.name);
      if (handled.has(updateKey)) {
        continue;
      }
      handled.add(updateKey);
      const action = update.credentials?.action ?? 'keep';
      if (action === 'remove') {
        continue;
      }
      if (action === 'replace') {
        rendered.push({
          encodedName: encodeXmlName(update.name),
          add: applyCredentialUpdate(section.add, update.credentials?.username ?? '', update.credentials?.password),
        });
      } else {
        rendered.push({
          encodedName: update.name === section.decodedName ? section.encodedName : encodeXmlName(update.name),
          add: section.add,
        });
      }
      continue;
    }
    if (removedOwnSources.has(normalizeSourceName(section.decodedName))) {
      continue;
    }
    rendered.push({ encodedName: section.encodedName, add: section.add });
  }

  for (const update of updates) {
    const updateKey = normalizeSourceName(update.name);
    if (handled.has(updateKey) || update.credentials?.action !== 'replace') {
      continue;
    }
    handled.add(updateKey);
    rendered.push({
      encodedName: encodeXmlName(update.name),
      add: applyCredentialUpdate([], update.credentials.username ?? '', update.credentials.password),
    });
  }

  const order = new Map<string, number>();
  updates.forEach((update, index) => {
    order.set(normalizeSourceName(update.name), index);
    if (update.originalName) {
      order.set(normalizeSourceName(update.originalName), index);
    }
  });
  const orderOf = (encodedName: string): number =>
    order.get(normalizeSourceName(decodeXmlName(encodedName))) ?? Number.MAX_SAFE_INTEGER;
  rendered.sort((left, right) => orderOf(left.encodedName) - orderOf(right.encodedName));

  return rendered
    .map((section) => renderCredentialSection(section.encodedName, section.add))
    .filter((section) => section.length > 0);
}

function applyCredentialUpdate(entries: XmlEntry[], username: string, password: string | undefined): XmlEntry[] {
  const result = entries.map((entry) => ({ $: { ...(entry.$ ?? {}) } }));
  const findEntry = (key: string): number =>
    result.findIndex((entry) => entry.$?.['key']?.toLowerCase() === key);

  const usernameIndex = findEntry('username');
  if (usernameIndex >= 0) {
    result[usernameIndex] = { $: { ...(result[usernameIndex].$ ?? {}), value: username } };
  } else {
    result.push({ $: { key: 'Username', value: username } });
  }

  if (password !== undefined) {
    const passwordIndex = findEntry('cleartextpassword');
    if (passwordIndex >= 0) {
      result[passwordIndex] = { $: { ...(result[passwordIndex].$ ?? {}), value: password } };
    } else {
      result.push({ $: { key: 'ClearTextPassword', value: password } });
    }
  }
  return result;
}

function findUpdate(updates: NuGetConfigSourceUpdate[], sourceName: string): NuGetConfigSourceUpdate | undefined {
  const normalized = normalizeSourceName(sourceName);
  return updates.find((update) =>
    normalizeSourceName(update.originalName ?? update.name) === normalized ||
    normalizeSourceName(update.name) === normalized
  );
}

function renderSectionElement(name: string, openingTag: string, children: string[], baseIndent: string): string {
  return [
    `${baseIndent}${openingTag}`,
    ...children.map((child) => indentLines(child, `${baseIndent}  `)),
    `${baseIndent}</${name}>`,
  ].join('\n');
}

function renderCredentialSection(encodedName: string, entries: XmlEntry[]): string {
  if (entries.length === 0) {
    return '';
  }
  return [
    `<${encodedName}>`,
    ...entries.map((entry) => `  ${renderAddEntry(entry)}`),
    `</${encodedName}>`,
  ].join('\n');
}

function indentLines(value: string, prefix: string): string {
  return value.split('\n').map((line) => `${prefix}${line}`).join('\n');
}

function renderAddEntry(entry: XmlEntry): string {
  const attributes = renderAttributes(entry.$ ?? {}, ['key', 'value']);
  return attributes.length > 0 ? `<add ${attributes} />` : '<add />';
}

function renderRemoveEntry(entry: XmlEntry): string {
  const attributes = renderAttributes(entry.$ ?? {}, ['key']);
  return attributes.length > 0 ? `<remove ${attributes} />` : '<remove />';
}

function renderAttributes(attributes: XmlAttributes, preferredOrder: string[]): string {
  const names = [
    ...preferredOrder.filter((name) => attributes[name] !== undefined),
    ...Object.keys(attributes).filter((name) => !preferredOrder.includes(name)),
  ];
  return names
    .map((name) => `${name}="${escapeXmlAttribute(attributes[name])}"`)
    .join(' ');
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function insertBeforeClosingConfiguration(text: string, sectionText: string): string {
  const closingTag = /<\/configuration\s*>/gi;
  let match: RegExpExecArray | null;
  let lastMatch: RegExpExecArray | undefined;
  while ((match = closingTag.exec(text)) !== null) {
    lastMatch = match;
  }
  if (!lastMatch) {
    throw new Error('The NuGet configuration file is missing the </configuration> closing tag.');
  }
  const before = text.slice(0, lastMatch.index).replace(/\s*$/, '');
  const after = text.slice(lastMatch.index);
  return `${before}\n${sectionText}\n${after}`;
}

function decodeXmlName(value: string): string {
  return value.replace(/_x([0-9a-f]{4})_/gi, (_, codePoint: string) => String.fromCharCode(Number.parseInt(codePoint, 16)));
}

function encodeXmlName(value: string): string {
  let result = '';
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const codePoint = value.charCodeAt(index);
    const isFirst = index === 0;
    const isValid = isFirst ? /[A-Za-z_]/.test(character) : /[A-Za-z0-9_.-]/.test(character);
    if (character === '_' && /^x[0-9a-f]{4}_/i.test(value.slice(index + 1, index + 7))) {
      result += '_x005f_';
    } else if (isValid) {
      result += character;
    } else {
      result += `_x${codePoint.toString(16).padStart(4, '0')}_`;
    }
  }
  return result || '_';
}

function normalizeSourceName(value: string): string {
  return decodeXmlName(value).toLowerCase();
}

function normalizePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function defaultConfigText(): string {
  return '<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n</configuration>\n';
}
