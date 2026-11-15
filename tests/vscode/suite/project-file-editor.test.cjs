const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const vscode = require('vscode');
const xml2js = require('xml2js');
const execFileAsync = promisify(execFile);

const repositoryRoot = path.resolve(__dirname, '../../..');
const fixturesRoot = path.join(repositoryRoot, 'tests', 'fixtures');
const command = 'nuget-assistant.test.applyProjectFileEdit';

suite('project file editing in the VS Code extension host', () => {
  let temporaryRoot;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('claudineyqr.nuget-assistant');
    assert.ok(extension, 'NuGet Assistant development extension must be available');
    await extension.activate();
  });

  setup(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-assistant-e2e-'));
  });

  teardown(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  test('adds, updates, and removes package references and builds with restored versions', async () => {
    const projectFolder = copyFixture('PackageEditHarness');
    const projectPath = path.join(projectFolder, 'PackageEditHarness.csproj');

    await vscode.commands.executeCommand(command, {
      operation: 'apply',
      projectPath,
      packageId: 'Newtonsoft.Json',
      version: '13.0.3',
    });
    await assertPackageReference(projectPath, 'Newtonsoft.Json', '13.0.3');
    await runDotnet(projectFolder, 'build');

    await vscode.commands.executeCommand(command, {
      operation: 'apply',
      projectPath,
      packageId: 'Newtonsoft.Json',
      version: '13.0.4',
    });
    await assertPackageReference(projectPath, 'Newtonsoft.Json', '13.0.4');
    await runDotnet(projectFolder, 'build');

    await vscode.commands.executeCommand(command, {
      operation: 'apply',
      projectPath,
      packageId: 'Newtonsoft.Json',
    });
    assert.equal((await findElements(projectPath, 'PackageReference', 'Newtonsoft.Json')).length, 0);
  });

  test('updates and adds packages in a batch using central package management', async () => {
    const projectFolder = copyFixture('CentralPackageHarness');
    const projectPath = path.join(projectFolder, 'CentralPackageHarness.csproj');
    const centralPath = path.join(projectFolder, 'Directory.Packages.props');

    await vscode.commands.executeCommand(command, {
      operation: 'applyMany',
      projectPath,
      updates: [
        { packageId: 'Newtonsoft.Json', version: '13.0.4' },
        { packageId: 'Polly', version: '8.4.2' },
      ],
    });

    await assertPackageReference(projectPath, 'Newtonsoft.Json', undefined);
    await assertPackageReference(projectPath, 'Polly', undefined);
    assert.equal((await findElements(centralPath, 'PackageVersion', 'Newtonsoft.Json'))[0].$.Version, '13.0.4');
    assert.equal((await findElements(centralPath, 'PackageVersion', 'Polly'))[0].$.Version, '8.4.2');
    await runDotnet(projectFolder, 'build');
  });

  function copyFixture(name) {
    const destination = path.join(temporaryRoot, name);
    fs.cpSync(path.join(fixturesRoot, name), destination, { recursive: true });
    return destination;
  }

  async function findElements(filePath, tagName, packageId) {
    let document;
    try {
      document = await xml2js.parseStringPromise(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      assert.fail(`${filePath} must contain valid XML: ${error.message}`);
    }
    const groups = document.Project.ItemGroup ?? [];
    return groups.flatMap((group) => group[tagName] ?? [])
      .filter((element) => element.$?.Include?.toLowerCase() === packageId.toLowerCase());
  }

  async function assertPackageReference(projectPath, packageId, version) {
    const matches = await findElements(projectPath, 'PackageReference', packageId);
    assert.equal(matches.length, 1, `Expected one PackageReference for ${packageId}`);
    assert.equal(matches[0].$.Version, version);
  }

  async function runDotnet(projectFolder, ...args) {
    try {
      await execFileAsync('dotnet', args, {
        cwd: projectFolder,
        encoding: 'utf8',
        timeout: 180000,
        env: { ...process.env, DOTNET_NOLOGO: '1', DOTNET_CLI_TELEMETRY_OPTOUT: '1' },
      });
    } catch (error) {
      assert.fail(`dotnet ${args.join(' ')} failed:\n${error.stdout}\n${error.stderr}`);
    }
  }
});
