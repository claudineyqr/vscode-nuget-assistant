# NuGet Assistant

## Maintaining UI translations

Keep **NuGet Assistant** unchanged in every language; it is the product name. The webview panel title also keeps the brand in English.

### Angular UI

Mark template text with a unique semantic ID, such as `i18n="@@toolbar.search.placeholder"`, or use a `$localize` ID such as `:@@operation.installing:` in code. Use distinct IDs for words with different meanings. Add each message to the Portuguese and Chinese catalogs under `src/app/i18n`, then run `npm run i18n:extract` to refresh the English catalog. Review translations when English text changes, and preserve placeholders such as `{$INTERPOLATION}`.

### VS Code and extension messages

Manifest strings in `package.json` use `%key%` references. Extension notifications, Quick Pick prompts, and authored error messages use semantic keys through `localize()` in `src/extension/services/localization.ts`. Maintain these keys in all three catalogs: `package.nls.json` (English), `package.nls.pt-br.json` (Brazilian Portuguese), and `package.nls.zh-cn.json` (Simplified Chinese). Preserve numbered placeholders such as `{0}`. Keep `displayName` and the extension `description` in English in `package.json`, outside the catalogs. Technical details supplied by the operating system, network, or NuGet source remain unchanged.

Localization tests check catalog key parity, locale selection, and placeholders.
