import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import NuGetConfigEditor from './nuget-config-editor';
import NuGetConfigLoader from './nuget-config-loader';

describe('NuGetConfigEditor', () => {
  let temporaryFolder: string;
  let appDataFolder: string;
  let projectFolder: string;
  let projectFilePath: string;
  let editor: NuGetConfigEditor;

  beforeEach(() => {
    temporaryFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-assistant-config-editor-'));
    appDataFolder = path.join(temporaryFolder, 'AppData');
    projectFolder = path.join(temporaryFolder, 'repo');
    fs.mkdirSync(projectFolder, { recursive: true });
    projectFilePath = path.join(projectFolder, 'project.csproj');
    fs.writeFileSync(projectFilePath, '', 'utf8');
    editor = new NuGetConfigEditor(new NuGetConfigLoader({ APPDATA: appDataFolder }));
  });

  afterEach(() => {
    fs.rmSync(temporaryFolder, { recursive: true, force: true });
  });

  const userConfigPath = (): string => path.join(appDataFolder, 'NuGet', 'NuGet.Config');

  const writeUserConfig = (content: string): void => {
    fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
    fs.writeFileSync(userConfigPath(), content, 'utf8');
  };

  const readUserConfig = (): string => fs.readFileSync(userConfigPath(), 'utf8');

  it('lists the discovered configuration files and defaults to the user configuration', async () => {
    const snapshot = await editor.loadAsync(projectFilePath);

    expect(snapshot.selectedFilePath).toBe(userConfigPath());
    expect(snapshot.fileExists).toBe(false);
    expect(snapshot.sources).toEqual([]);
    expect(snapshot.files[0]).toEqual({ path: userConfigPath(), kind: 'user', exists: false });
  });

  it('lists only user-level configuration files when no project is provided', async () => {
    const projectConfigPath = path.join(projectFolder, 'NuGet.Config');
    writeUserConfig('<configuration></configuration>');
    fs.mkdirSync(path.dirname(projectConfigPath), { recursive: true });
    fs.writeFileSync(projectConfigPath, '<configuration></configuration>', 'utf8');

    const snapshot = await editor.loadAsync();

    expect(snapshot.selectedFilePath).toBe(userConfigPath());
    expect(snapshot.files.every((file) => file.kind !== 'project')).toBe(true);
  });

  it('loads sources, disabled state, and credential metadata without exposing passwords', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="Private" value="https://private.example/v3/index.json" protocolVersion="3" />
  </packageSources>
  <disabledPackageSources>
    <add key="Private" value="true" />
  </disabledPackageSources>
  <packageSourceCredentials>
    <Private>
      <add key="Username" value="user" />
      <add key="ClearTextPassword" value="secret" />
    </Private>
  </packageSourceCredentials>
</configuration>`);

    const snapshot = await editor.loadAsync(projectFilePath, userConfigPath());

    expect(snapshot.fileExists).toBe(true);
    expect(snapshot.sources).toEqual([
      { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, hasPassword: false },
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: false,
        username: 'user',
        hasPassword: true,
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('creates a missing configuration file with the managed sections', async () => {
    const snapshot = await editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true },
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: false,
        credentials: { action: 'replace', username: 'user', password: 'secret' },
      },
    ]);

    const text = readUserConfig();
    expect(text).toContain('<packageSources>');
    expect(text).toContain('key="nuget.org"');
    expect(text).toContain('value="https://private.example/v3/index.json"');
    expect(text).toContain('<disabledPackageSources>');
    expect(text).toContain('value="true"');
    expect(text).toContain('<Private>');
    expect(text).toContain('value="secret"');
    expect(snapshot.fileExists).toBe(true);
    expect(snapshot.sources.map((source) => source.name)).toEqual(['nuget.org', 'Private']);
    expect(snapshot.sources[1]).toMatchObject({ enabled: false, username: 'user', hasPassword: true });
  });

  it('edits sources while preserving unrelated XML and existing attributes', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <config>
    <add key="globalPackagesFolder" value="packages" />
  </config>
  <!-- keep this comment -->
  <packageSources>
    <add key="nuget.org" value="https://old.example/v3/index.json" protocolVersion="3" />
    <add key="remove-me" value="https://remove.example/v3/index.json" />
  </packageSources>
</configuration>`);

    const snapshot = await editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://new.example/v3/index.json', enabled: true },
    ]);

    const text = readUserConfig();
    expect(text).toContain('<config>');
    expect(text).toContain('globalPackagesFolder');
    expect(text).toContain('keep this comment');
    expect(text).toContain('protocolVersion="3"');
    expect(text).toContain('value="https://new.example/v3/index.json"');
    expect(text).not.toContain('remove-me');
    expect(snapshot.sources.map((source) => source.name)).toEqual(['nuget.org']);
  });

  it('persists the source and credential order supplied by the UI', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="First" value="https://first.example/v3/index.json" />
    <add key="Second" value="https://second.example/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <First><add key="Username" value="first-user" /><add key="ClearTextPassword" value="first-pass" /></First>
    <Second><add key="Username" value="second-user" /><add key="ClearTextPassword" value="second-pass" /></Second>
  </packageSourceCredentials>
</configuration>`);

    const sources = [
      { name: 'Second', url: 'https://second.example/v3/index.json', enabled: true },
      { name: 'First', url: 'https://first.example/v3/index.json', enabled: true },
    ];
    const snapshot = await editor.saveAsync(projectFilePath, userConfigPath(), sources);

    expect(snapshot.sources.map((source) => source.name)).toEqual(['Second', 'First']);
    const text = readUserConfig();
    expect(text.indexOf('key="Second"')).toBeLessThan(text.indexOf('key="First"'));
    expect(text.indexOf('<Second>')).toBeLessThan(text.indexOf('<First>'));
  });

  it('renames a source and keeps its credentials and disabled state in sync', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="Old" value="https://old.example/v3/index.json" />
  </packageSources>
  <disabledPackageSources>
    <add key="Old" value="true" />
  </disabledPackageSources>
  <packageSourceCredentials>
    <Old>
      <add key="Username" value="old-user" />
      <add key="ClearTextPassword" value="old-pass" />
    </Old>
  </packageSourceCredentials>
</configuration>`);

    await editor.saveAsync(projectFilePath, userConfigPath(), [
      {
        name: 'Renamed',
        url: 'https://renamed.example/v3/index.json',
        enabled: false,
        originalName: 'Old',
        credentials: { action: 'keep' },
      },
    ]);

    const text = readUserConfig();
    expect(text).toContain('key="Renamed"');
    expect(text).toContain('value="https://renamed.example/v3/index.json"');
    expect(text).toContain('<Renamed>');
    expect(text).toContain('value="old-user"');
    expect(text).toContain('value="old-pass"');
    expect(text).not.toContain('key="Old"');
    expect(text).not.toContain('<Old>');
    expect(text).toContain('<disabledPackageSources>');
  });

  it('replaces credentials for a source while keeping the password when blank', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="Private" value="https://private.example/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <Private>
      <add key="Username" value="old-user" />
      <add key="ClearTextPassword" value="old-pass" />
    </Private>
  </packageSourceCredentials>
</configuration>`);

    await editor.saveAsync(projectFilePath, userConfigPath(), [
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: true,
        credentials: { action: 'replace', username: 'new-user', password: 'new-pass' },
      },
    ]);

    const replaced = readUserConfig();
    expect(replaced).toContain('value="new-user"');
    expect(replaced).toContain('value="new-pass"');
    expect(replaced).not.toContain('old-user');
    expect(replaced).not.toContain('old-pass');

    await editor.saveAsync(projectFilePath, userConfigPath(), [
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: true,
        credentials: { action: 'replace', username: 'new-user' },
      },
    ]);

    expect(readUserConfig()).toContain('value="new-pass"');
  });

  it('removes credentials and dropped sources together with their disabled entries', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" />
    <add key="Gone" value="https://gone.example/v3/index.json" />
  </packageSources>
  <disabledPackageSources>
    <add key="Gone" value="true" />
  </disabledPackageSources>
  <packageSourceCredentials>
    <Gone>
      <add key="Username" value="gone-user" />
      <add key="ClearTextPassword" value="gone-pass" />
    </Gone>
  </packageSourceCredentials>
</configuration>`);

    await editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true },
    ]);

    const text = readUserConfig();
    expect(text).not.toContain('Gone');
    expect(text).not.toContain('gone-user');
    expect(text).not.toContain('gone-pass');
    expect(text).not.toContain('<disabledPackageSources>');
  });

  it('removes credentials for a source when requested', async () => {
    writeUserConfig(`<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="Private" value="https://private.example/v3/index.json" />
  </packageSources>
  <packageSourceCredentials>
    <Private>
      <add key="Username" value="user" />
      <add key="ClearTextPassword" value="pass" />
    </Private>
  </packageSourceCredentials>
</configuration>`);

    await editor.saveAsync(projectFilePath, userConfigPath(), [
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: true,
        credentials: { action: 'remove' },
      },
    ]);

    const text = readUserConfig();
    expect(text).not.toContain('<Private>');
    expect(text).not.toContain('value="pass"');
  });

  it('rejects paths that are not part of the discovered configuration files', async () => {
    const outsidePath = path.join(temporaryFolder, 'outside.config');

    await expect(editor.loadAsync(projectFilePath, outsidePath)).rejects.toThrow();
    await expect(editor.saveAsync(projectFilePath, outsidePath, [])).rejects.toThrow();
    await expect(editor.saveAsync(projectFilePath, userConfigPath() + '.bak', [])).rejects.toThrow();
  });

  it('rejects invalid updates', async () => {
    writeUserConfig('<configuration></configuration>');

    await expect(editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true },
      { name: 'NuGet.org', url: 'https://other.example/v3/index.json', enabled: true },
    ])).rejects.toThrow(/already exists/);

    await expect(editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://', enabled: true },
    ])).rejects.toThrow(/not valid/);

    await expect(editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'Renamed', url: 'https://renamed.example/v3/index.json', enabled: true, originalName: 'Missing' },
    ])).rejects.toThrow(/not found/);

    await expect(editor.saveAsync(projectFilePath, userConfigPath(), [
      { name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, credentials: { action: 'replace', username: '', password: 'pass' } },
    ])).rejects.toThrow(/credentials/);

    await expect(editor.saveAsync(projectFilePath, userConfigPath(), 'not-an-array')).rejects.toThrow();
  });

  it('reports invalid XML as a parsing error', async () => {
    writeUserConfig('<configuration><packageSources>');

    await expect(editor.loadAsync(projectFilePath, userConfigPath())).rejects.toThrow(/invalid XML/i);
  });
});
