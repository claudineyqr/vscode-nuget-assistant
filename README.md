# NuGet Assistant

Manage NuGet packages graphically in VS Code. Search, install, update, and remove packages from .NET projects and solutions.

## How to Use

1. In the Explorer, right-click a `.csproj`, `.fsproj`, or `.vbproj` file.
2. Select **NuGet Assistant: Manage Project Packages**.

To manage packages across a solution, right-click an `.sln` or `.slnx` file and select **NuGet Assistant: Manage Solution Packages**.

You can also launch these commands from the Command Palette (`Ctrl+Shift+P`) by searching for **NuGet Assistant**.

## Features

- Search for packages by name from a specific source or across **All** configured sources.
- Choose the target project before applying package changes.
- Install a specific package version.
- Update or uninstall installed packages.
- Update multiple packages simultaneously.
- View package details, including descriptions, authors, licenses, dependencies, tags, and project links.
- View known vulnerabilities and related security advisories.
- Supports NuGet V2 and V3 feeds, including nuget.org, Azure Artifacts, GitHub Packages, GitLab, MyGet, JFrog Artifactory, Sonatype Nexus, ProGet, and other compatible private feeds.
- Works on Linux, macOS, and Windows.

Package operations are executed through the `dotnet` CLI. Ensure that the .NET SDK is installed and available in your `PATH`.

## Package Source Configuration

Package sources are loaded from the following locations, in order:

- User configuration file:
  - Windows: `%APPDATA%\NuGet\NuGet.Config`
  - macOS/Linux: `~/.nuget/NuGet/NuGet.Config`
- Additional configuration files:
  - Windows: `%APPDATA%\NuGet\config`
  - macOS/Linux: `~/.nuget/NuGet/config`
- `NuGet.Config` files located in the project directory and its parent directories.

Example configuration for public and private package sources:

```xml
<configuration>
  <packageSources>
    <add key="NuGet.org" value="https://api.nuget.org/v3/index.json" />
    <add key="Private" value="https://nuget.example.com/v3/index.json" />
    <add key="github" value="https://nuget.pkg.github.com/NAMESPACE/index.json" />
  </packageSources>
</configuration>
```

### Credentials for Private Feeds

To enable package searches on private feeds, add `Username` and `ClearTextPassword` entries under `packageSourceCredentials`:

```xml
<packageSourceCredentials>
  <Private>
    <add key="Username" value="my-username" />
    <add key="ClearTextPassword" value="my-password" />
  </Private>
</packageSourceCredentials>
```

> **Note:** Only `ClearTextPassword` is supported. Encrypted `Password` entries are ignored.

### Credentials over HTTP

By default, NuGet Assistant blocks HTTP requests that would send credentials defined in `packageSourceCredentials`. HTTPS requests are not affected, and HTTP requests that do not include credentials continue to work normally.

To allow credentials to be sent over HTTP, enable the following VS Code setting in your User or Workspace settings:

```json
{
  "nuget-assistant.allowInsecureHttpCredentials": true
}
```

**Warning**: HTTP traffic is not encrypted. When this setting is enabled, credentials may be exposed to anyone who can intercept or observe the network connection. Only enable this setting for trusted package sources and trusted network environments.
