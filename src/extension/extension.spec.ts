import * as vscode from 'vscode';
import * as quickPick from './services/quick-pick';
import { ProjectFileEditor } from './services/project-file-editor';
import ConfigPanel from './config-panel';
import UiPanel from './ui-panel';
import { activate } from './extension';

describe('extension activation', () => {
  const descriptors: Array<[object, string, PropertyDescriptor | undefined]> = [];
  const defineMock = (target: object, key: string, value: unknown) => {
    descriptors.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
  };

  let registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  let configChanged: ((event: { affectsConfiguration(section: string): boolean }) => void) | undefined;
  let context: vscode.ExtensionContext;
  const outputChannel = { dispose: jest.fn() };

  beforeEach(() => {
    registeredCommands = new Map();
    configChanged = undefined;
    descriptors.length = 0;
    jest.clearAllMocks();

    defineMock(vscode.window, 'createOutputChannel', jest.fn(() => outputChannel));
    defineMock(vscode.workspace, 'onDidChangeConfiguration', jest.fn((listener) => {
      configChanged = listener;
      return { dispose: jest.fn() };
    }));
    defineMock(vscode, 'ExtensionMode', { Production: 1, Test: 3 });
    defineMock(vscode, 'commands', {
      registerCommand: jest.fn((command: string, callback: (...args: unknown[]) => unknown) => {
        registeredCommands.set(command, callback);
        return { dispose: jest.fn() };
      }),
    });

    context = {
      extensionPath: '/extension',
      subscriptions: [],
      workspaceState: {} as vscode.Memento,
      extensionMode: vscode.ExtensionMode.Production,
    } as unknown as vscode.ExtensionContext;
  });

  afterEach(() => {
    for (const [target, key, descriptor] of descriptors.reverse()) {
      if (descriptor) {
        Object.defineProperty(target, key, descriptor);
      } else {
        Reflect.deleteProperty(target, key);
      }
    }
    jest.restoreAllMocks();
  });

  it('registers the project and solution commands and responds to language changes', () => {
    const reload = jest.spyOn(UiPanel, 'reloadAllForLanguageChange');
    const reloadConfig = jest.spyOn(ConfigPanel, 'reloadAllForLanguageChange');

    activate(context);

    expect([...registeredCommands.keys()]).toEqual([
      'nuget-assistant.managePackages',
      'nuget-assistant.managePackagesPalette',
      'nuget-assistant.manageSolutionPackages',
      'nuget-assistant.manageSolutionPackagesPalette',
      'nuget-assistant.manageConfigurationsPalette',
    ]);
    expect(context.subscriptions).toHaveLength(7);

    configChanged?.({ affectsConfiguration: (section) => section === 'nuget-assistant.language' });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
    configChanged?.({ affectsConfiguration: () => false });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reloadConfig).toHaveBeenCalledTimes(1);
  });

  it('opens a project or solution directly from the Explorer command', () => {
    const createOrShow = jest.spyOn(UiPanel, 'createOrShow').mockReturnValue({});
    const project = { fsPath: '/repo/App.csproj' } as vscode.Uri;
    const solution = { fsPath: '/repo/App.sln' } as vscode.Uri;

    activate(context);
    registeredCommands.get('nuget-assistant.managePackages')?.(project);
    registeredCommands.get('nuget-assistant.manageSolutionPackages')?.(solution);

    expect(createOrShow).toHaveBeenNthCalledWith(1, '/extension', project, expect.anything(), context.workspaceState);
    expect(createOrShow).toHaveBeenNthCalledWith(2, '/extension', solution, expect.anything(), context.workspaceState);
  });

  it('opens the selected palette target and does nothing when selection is cancelled', async () => {
    const pickProject = jest.spyOn(quickPick, 'pickProjectFile');
    const pickSolution = jest.spyOn(quickPick, 'pickSolutionFile');
    const createOrShow = jest.spyOn(UiPanel, 'createOrShow').mockReturnValue({});
    const project = { fsPath: '/repo/App.csproj' } as vscode.Uri;
    const solution = { fsPath: '/repo/App.sln' } as vscode.Uri;
    pickProject.mockResolvedValueOnce(project).mockResolvedValueOnce(undefined);
    pickSolution.mockResolvedValueOnce(solution);

    activate(context);
    await registeredCommands.get('nuget-assistant.managePackagesPalette')?.();
    await registeredCommands.get('nuget-assistant.manageSolutionPackagesPalette')?.();
    await registeredCommands.get('nuget-assistant.managePackagesPalette')?.();

    expect(pickProject).toHaveBeenCalledTimes(2);
    expect(pickSolution).toHaveBeenCalledTimes(1);
    expect(createOrShow).toHaveBeenCalledTimes(2);
    expect(createOrShow).toHaveBeenNthCalledWith(1, '/extension', project, expect.anything(), context.workspaceState);
    expect(createOrShow).toHaveBeenNthCalledWith(2, '/extension', solution, expect.anything(), context.workspaceState);
  });

  it('opens the NuGet configurations page from the command palette without a project', () => {
    const createOrShow = jest.spyOn(ConfigPanel, 'createOrShow').mockReturnValue(undefined);

    activate(context);
    registeredCommands.get('nuget-assistant.manageConfigurationsPalette')?.();

    expect(createOrShow).toHaveBeenCalledTimes(1);
    expect(createOrShow).toHaveBeenCalledWith('/extension', outputChannel);
  });

  it('registers the project edit test command only in the extension test host', () => {
    context = { ...context, extensionMode: vscode.ExtensionMode.Test };
    const apply = jest.spyOn(ProjectFileEditor.prototype, 'apply').mockReturnValue(jest.fn());
    const applyMany = jest.spyOn(ProjectFileEditor.prototype, 'applyMany').mockReturnValue(jest.fn());

    activate(context);
    expect(registeredCommands.has('nuget-assistant.test.applyProjectFileEdit')).toBe(true);

    registeredCommands.get('nuget-assistant.test.applyProjectFileEdit')?.({
      operation: 'apply', projectPath: '/repo/App.csproj', packageId: 'Contoso.Widget', version: '2.0.0',
    });
    registeredCommands.get('nuget-assistant.test.applyProjectFileEdit')?.({
      operation: 'applyMany', projectPath: '/repo/App.csproj', updates: [],
    });

    expect(apply).toHaveBeenCalledWith('/repo/App.csproj', 'Contoso.Widget', '2.0.0');
    expect(applyMany).toHaveBeenCalledWith('/repo/App.csproj', []);
    expect(() => registeredCommands.get('nuget-assistant.test.applyProjectFileEdit')?.({
      operation: 'apply', projectPath: '/repo/App.csproj',
    })).toThrow('A package ID is required');
  });
});
