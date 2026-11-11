import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import NuGetConfigLoader from './nuget-config-loader';
import { NuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';

describe('NuGetConfigLoader', () => {
  let temporaryFolder: string;
  let appDataFolder: string;
  let projectFolder: string;

  beforeEach(async () => {
    temporaryFolder = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'nuget-assistant-'));
    appDataFolder = path.join(temporaryFolder, 'AppData', 'Roaming');
    projectFolder = path.join(temporaryFolder, 'repo', 'src');
    await fs.promises.mkdir(projectFolder, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(temporaryFolder, { recursive: true, force: true });
  });

  it('merges user and ancestor configs and applies clear, remove, and disabled sources', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="user" value="https://user.example/index.json" /><add key="removed" value="https://removed.example/index.json" /></packageSources></configuration>`
    );
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'config', '01.Config'),
      `<configuration><packageSources><add key="additional" value="https://additional.example/index.json" /></packageSources><disabledPackageSources><add key="additional" value="true" /></disabledPackageSources></configuration>`
    );
    await writeConfig(
      path.join(temporaryFolder, 'repo', 'NuGet.Config'),
      `<configuration><packageSources><remove key="removed" /><add key="user" value="https://ancestor.example/index.json" /></packageSources></configuration>`
    );
    await writeConfig(
      path.join(projectFolder, 'NuGet.Config'),
      `<configuration><packageSources><clear /><add key="project" value="https://project.example/index.json" /></packageSources><disabledPackageSources><add key="project" value="true" /></disabledPackageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');

    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([]);
  });

  it('omits disabled sources while keeping enabled sources', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="nuget.org.v2" value="https://disabled.example/v2" /><add key="private" value="https://private.example/v3/index.json" /></packageSources><disabledPackageSources><add key="nuget.org.v2" value="true" /></disabledPackageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'private', url: 'https://private.example/v3/index.json', authorizationHeader: undefined },
    ]);
  });

  it('allows a later config to re-enable a disabled source with false', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="nuget.org.v2" value="https://nuget.example/v2" /></packageSources><disabledPackageSources><add key="nuget.org.v2" value="true" /></disabledPackageSources></configuration>`
    );
    await writeConfig(
      path.join(projectFolder, 'NuGet.Config'),
      `<configuration><disabledPackageSources><add key="nuget.org.v2" value="false" /></disabledPackageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'nuget.org.v2', url: 'https://nuget.example/v2', authorizationHeader: undefined },
    ]);
  });

  it('applies remove and clear to disabled package sources', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="removed" value="https://removed.example" /><add key="still-disabled" value="https://disabled.example" /></packageSources><disabledPackageSources><add key="removed" value="true" /><add key="still-disabled" value="true" /></disabledPackageSources></configuration>`
    );
    await writeConfig(
      path.join(temporaryFolder, 'repo', 'NuGet.Config'),
      `<configuration><disabledPackageSources><remove key="removed" /></disabledPackageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'removed', url: 'https://removed.example', authorizationHeader: undefined },
    ]);

    await writeConfig(
      path.join(projectFolder, 'NuGet.Config'),
      `<configuration><disabledPackageSources><clear /></disabledPackageSources></configuration>`
    );

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'removed', url: 'https://removed.example', authorizationHeader: undefined },
      { name: 'still-disabled', url: 'https://disabled.example', authorizationHeader: undefined },
    ]);
  });

  it('finds NuGet.Config case-insensitively', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'nuget.config'),
      `<configuration><packageSources><add key="user" value="https://user.example/index.json" /></packageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');

    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toHaveLength(1);
  });

  it('classifies malformed NuGet.Config XML as a data parsing error', async () => {
    await writeConfig(path.join(appDataFolder, 'NuGet', 'NuGet.Config'), '<configuration><packageSources>');
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).rejects.toBeInstanceOf(NuGetDataParsingError);
  });

  it('loads the user config from the Unix NuGet folder when APPDATA is unavailable', async () => {
    const homeFolder = path.join(temporaryFolder, 'home');
    await writeConfig(
      path.join(homeFolder, '.nuget', 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="user" value="https://user.example/index.json" /></packageSources></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');

    const loader = new NuGetConfigLoader({ HOME: homeFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'user', url: 'https://user.example/index.json', authorizationHeader: undefined },
    ]);
  });

  it('reads NuGet.Config from the current platform user profile using the real filesystem', async () => {
    const userProfileFolder = path.join(temporaryFolder, 'user-profile');
    const userNuGetFolder = process.platform === 'win32'
      ? path.join(userProfileFolder, 'AppData', 'Roaming', 'NuGet')
      : path.join(userProfileFolder, '.nuget', 'NuGet');
    const configPath = path.join(userNuGetFolder, 'NuGet.Config');
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    const sourceUrl = 'https://profile.example/v3/index.json';

    await writeConfig(
      configPath,
      `<configuration><packageSources><add key="profile" value="${sourceUrl}" /></packageSources></configuration>`
    );
    await fs.promises.writeFile(projectFilePath, '');

    const environment: NodeJS.ProcessEnv = process.platform === 'win32'
      ? { APPDATA: path.dirname(userNuGetFolder) }
      : { HOME: userProfileFolder };
    const loader = new NuGetConfigLoader(environment);

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      { name: 'profile', url: sourceUrl, authorizationHeader: undefined },
    ]);
  });

  it('creates a Basic authorization header from clear text credentials', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="private" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="user" /><add key="ClearTextPassword" value="secret" /></private></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');

    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'private',
        url: 'https://private.example/index.json',
        authorizationHeader: 'Basic dXNlcjpzZWNyZXQ=',
      },
    ]);
  });

  it('expands environment variables in usernames and clear text passwords', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="private" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="%FEED_USERNAME%" /><add key="ClearTextPassword" value="%FEED_PASSWORD%" /></private></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({
      APPDATA: appDataFolder,
      FEED_USERNAME: 'feed-user',
      FEED_PASSWORD: 'feed-secret',
    });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'private',
        url: 'https://private.example/index.json',
        authorizationHeader: 'Basic ZmVlZC11c2VyOmZlZWQtc2VjcmV0',
      },
    ]);
  });

  it('keeps missing variables literal and replaces empty variables with an empty value', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="private" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="%MISSING_USERNAME%" /><add key="ClearTextPassword" value="%EMPTY_PASSWORD%" /></private></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder, EMPTY_PASSWORD: '' });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'private',
        url: 'https://private.example/index.json',
        authorizationHeader: 'Basic JU1JU1NJTkdfVVNFUk5BTUUlOg==',
      },
    ]);
  });

  it('expands environment variables only once', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="private" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="user" /><add key="ClearTextPassword" value="%FEED_PASSWORD%" /></private></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const loader = new NuGetConfigLoader({
      APPDATA: appDataFolder,
      FEED_PASSWORD: '%NESTED_PASSWORD%',
      NESTED_PASSWORD: 'should-not-be-expanded',
    });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'private',
        url: 'https://private.example/index.json',
        authorizationHeader: 'Basic dXNlcjolTkVTVEVEX1BBU1NXT1JEJQ==',
      },
    ]);
  });

  it('skips encrypted Password credentials and logs that they are unsupported', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="private" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><private><add key="Username" value="user" /><add key="Password" value="encrypted-value" /></private></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');
    const logger = jest.fn();
    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder }, fs.promises, logger);

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'private',
        url: 'https://private.example/index.json',
        authorizationHeader: undefined,
      },
    ]);
    expect(logger).toHaveBeenCalledWith(
      'Ignoring encrypted Password for source "private"; only ClearTextPassword is supported.'
    );
  });

  it('matches credentials whose source name was XML-encoded by NuGet', async () => {
    await writeConfig(
      path.join(appDataFolder, 'NuGet', 'NuGet.Config'),
      `<configuration><packageSources><add key="Private Feed" value="https://private.example/index.json" /></packageSources><packageSourceCredentials><Private_x0020_Feed><add key="Username" value="user" /><add key="ClearTextPassword" value="secret" /></Private_x0020_Feed></packageSourceCredentials></configuration>`
    );
    const projectFilePath = path.join(projectFolder, 'project.csproj');
    await fs.promises.writeFile(projectFilePath, '');

    const loader = new NuGetConfigLoader({ APPDATA: appDataFolder });

    await expect(loader.loadAsync(projectFilePath)).resolves.toEqual([
      {
        name: 'Private Feed',
        url: 'https://private.example/index.json',
        authorizationHeader: 'Basic dXNlcjpzZWNyZXQ=',
      },
    ]);
  });

  async function writeConfig(filePath: string, content: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
  }
});
