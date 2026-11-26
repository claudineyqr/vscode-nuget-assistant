# AGENTS.md

## What this is

A VS Code extension with an Angular 22 webview UI and a Node extension host in one package.

- `src/extension/` — VS Code host (CommonJS): commands, webview panel, NuGet HTTP proxy, project/solution editing.
- `src/app/` — Angular webview UI (standalone components).
- `src/shared/` — message/type contracts imported by both sides. Keep it free of `vscode`, Angular, and Node-only APIs.
- Entry points: `src/extension/extension.ts` (manifest `main` is `dist/src/extension/extension.js`) and `src/main.ts` (webview bootstrap).

## Commands

```bash
npm ci
npm run build          # Angular dev build + tsc extension -> dist
npm run lint           # ng lint; only covers src/**/*.ts and src/**/*.html
npm test               # all Jest unit tests
npx jest src/app/services/package-manager.service.spec.ts   # one Jest file
npm run test:e2e       # extension-host integration tests; run build first
npm run i18n:extract   # refresh src/app/i18n/messages.en.json
npm run package        # VSIX; vscode:prepublish runs package-all
```

- CI uses Node 24 and .NET SDK 8. E2E fixtures target `net8.0`.
- `npm run build` must precede `npm run test:e2e`; the test runner does not build. On Linux, prefix e2e with `xvfb-run -a`.
- `npm run start` only starts Angular's dev server; it does not provide the VS Code webview bridge. Use F5 → **Run Extension** (its `preLaunchTask` runs `npm run build`).
- `npm run build` is a dev build (Angular development config + unbundled `tsc`). `npm run package-all` uses the production Angular config and a webpack bundle for the extension host.

## Architecture gotchas

- The webview never fetches NuGet directly: `UiPanel` injects a CSP with `connect-src 'none'`. All HTTP goes through `VscodeService.requestText` → `nuget-http-request` → `WebviewMessageHandler`. Do not add `fetch`/`HttpClient` calls in `src/app`.
- Webview messages are untrusted. Validate IDs, versions, URLs, headers, and project paths through `src/extension/services/security-validation.ts`; keep the credential/redirect/private-network checks there.
- `UiPanel` reads `dist/index.html` at runtime and rewrites CSP, `<base href>`, and locale. The Angular build clears `dist`, so always run `ng build` before `tsc` (as `npm run build` does); running `ng build` afterward deletes `dist/src/extension`.
- Extension → UI messages are handled in `app.component.ts` (`MessageFromExtension`); UI → extension commands are handled in `webview-message-handler.ts`. Add both sides of a new message type in `src/shared/models`.
- Package execution defaults to `projectFile` mode: edit `.csproj` directly, then run restore and roll back on failure. Only `.csproj` is directly editable; `.vbproj`/`.fsproj` fall back to `dotnet`. CPM updates `Directory.Packages.props`. `dotnet` mode shells out to `dotnet add/remove package`.
- NuGet config loading mirrors NuGet's hierarchy in `nuget-config-loader.ts`. Only `ClearTextPassword` is supported; credentials stay in the extension and are redacted before reaching the webview.

## Testing notes

- Unit specs are colocated as `*.spec.ts` and run with `jest-preset-angular`; `npm test` does not run the extension-host suite. VS Code is auto-mocked from the root `__mocks__/vscode.ts`; extend that mock when new VS Code APIs are used in unit tests.
- E2E is Mocha TDD (`suite`/`test`) inside the real extension host via `@vscode/test-electron`. `tests/vscode/suite/index.cjs` explicitly lists test files — register any new suite there.
- E2E copies fixtures to a temp directory and runs `dotnet build`, so it needs the .NET 8 SDK and network access to download VS Code stable.
- The `nuget-assistant.test.applyProjectFileEdit` command exists only in `ExtensionMode.Test`; it lets E2E exercise the production editor.
- `runTest.cjs` clears `ELECTRON_RUN_AS_NODE`; keep that or the Electron test host rejects VS Code flags.

## Localization

- Angular messages live in `src/app/i18n/messages.en.json`, `messages.pt-BR.json`, and `messages.zh-CN.json`. Use semantic IDs such as `@@toolbar.search.placeholder`; the build fails on missing translations.
- Extension/manifest messages live in `package.nls.json`, `package.nls.pt-br.json`, and `package.nls.zh-cn.json` and are read through `localize()` in `src/extension/services/localization.ts`.
- Tests enforce catalog key parity and placeholder parity. Keep the product name "NuGet Assistant" untranslated. Full rules: `docs/README.md`.

## Release conventions

- PRs to `main` run CI on macOS, Ubuntu, and Windows: install, test, build, e2e, package. Lint is not run in CI, so run it locally.
- Pushes to `main` trigger semantic-release in `.github/workflows/cd.yml`; use Conventional Commits. Don't hand-bump the version in feature PRs.
