import { ExtensionMessage } from '../../shared/models/extension-message';
import { InstallMessage, NuGetHttpRequestMessage, UninstallMessage } from '../../shared/models/ui-message';
import { formatErrorMessage } from '../../shared/utils/error-message';
import * as vscode from 'vscode';
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as path from 'node:path';

import NuGetConfigLoader from './nuget-config-loader';
import ProjectFileLoader from './project-file-loader';
import SolutionLoader from './solution-loader';
import { TaskManager } from './task-manager';
import {
  assertHttpCredentialsAllowed,
  isRecord,
  isValidPackageId,
  isValidPackageVersion,
  isValidRequestHeaders,
  createPinnedAddressLookup,
  parseHttpUrl,
  redactPackageSourceCredentials,
  selectRequestAddress,
  shouldSendSourceAuthorization,
  validateProjectTargets,
} from './security-validation';

interface ActiveNuGetRequest {
  cancelled: boolean;
  connections: Set<http.ClientRequest>;
}

export default class WebviewMessageHandler {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly projectFileLoader: ProjectFileLoader;
  private readonly solutionLoader: SolutionLoader;
  private readonly nuGetConfigLoader: NuGetConfigLoader;
  private readonly taskManager: TaskManager;
  private readonly taskName = 'nuget-assistant';
  private static readonly selectedSourceKey = 'nuget-assistant.selectedSourceUrl';
  private configuredSources: Awaited<ReturnType<NuGetConfigLoader['loadAsync']>> = [];
  private readonly activeNuGetRequests = new Map<string, ActiveNuGetRequest>();

  public constructor(
    private readonly webview: vscode.Webview,
    private readonly projectFilePath: string,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly workspaceState: vscode.Memento
  ) {
    this.projectFileLoader = new ProjectFileLoader();
    this.solutionLoader = new SolutionLoader(this.projectFileLoader);
    this.nuGetConfigLoader = new NuGetConfigLoader(process.env, undefined, (message) => this.log(message));
    this.taskManager = new TaskManager(() => this.loadProject());

    this.webview.onDidReceiveMessage(
      (message: unknown) => {
        this.handleMessage(message);
      },
      null,
      this.disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      () => {
        this.loadConfiguration();
      },
      null,
      this.disposables
    );
  }

  private handleMessage(message: unknown): void {
    if (!isRecord(message) || typeof message['command'] !== 'string') {
      return;
    }
    switch (message['command']) {
      case 'add-package':
        this.addPackage(message as unknown as InstallMessage);
        return;
      case 'remove-package':
        this.removePackage(message as unknown as UninstallMessage);
        return;
      case 'load-project':
        this.loadProject();
        this.loadConfiguration();
        return;
      case 'reload-sources':
        this.loadConfiguration();
        return;
      case 'select-source':
        this.cancelActiveNuGetRequests();
        void this.saveSelectedSource(message['sourceUrl']);
        return;
      case 'nuget-diagnostic':
        if (typeof message['message'] === 'string') {
          this.log(this.getErrorMessage(message['message']));
        }
        return;
      case 'nuget-http-request':
        void this.handleNuGetHttpRequest(message as unknown as NuGetHttpRequestMessage);
        return;
    }
  }

  private addPackage(message: InstallMessage): void {
    const source = this.configuredSources.find((candidate) => candidate.url === message.packageSourceUrl);
    const sourceUrl = parseHttpUrl(message.packageSourceUrl);
    if (
      !isValidPackageId(message.packageId) || !isValidPackageVersion(message.packageVersion) ||
      !source || !sourceUrl
    ) {
      return;
    }
    const projectPaths = this.getValidatedProjectPaths(message);
    if (!projectPaths.length) {
      return;
    }
    projectPaths.forEach((projectPath) => {
      const args = [
        'add',
        { value: projectPath, quoting: vscode.ShellQuoting.Strong },
        'package',
        { value: message.packageId, quoting: vscode.ShellQuoting.Strong },
        '-v',
        { value: message.packageVersion, quoting: vscode.ShellQuoting.Strong },
        '-s',
        { value: message.packageSourceUrl, quoting: vscode.ShellQuoting.Strong },
        '--interactive',
      ];

      this.taskManager.executeTask(this.createTask('add', args));
    });
  }

  private removePackage(message: UninstallMessage): void {
    if (!isValidPackageId(message.packageId)) {
      return;
    }
    const projectPaths = this.getValidatedProjectPaths(message);
    if (!projectPaths.length) {
      return;
    }
    projectPaths.forEach((projectPath) => {
      const args = [
        'remove',
        { value: projectPath, quoting: vscode.ShellQuoting.Strong },
        'package',
        { value: message.packageId, quoting: vscode.ShellQuoting.Strong },
      ];
      this.taskManager.executeTask(this.createTask('remove', args));
    });
  }

  private getValidatedProjectPaths(message: UninstallMessage): string[] {
    const selectedPaths = message.projectPaths ?? (typeof message.projectName === 'string' ? [message.projectName] : []);
    const extension = path.extname(this.projectFilePath).toLowerCase();
    let allowedPaths: string[];
    try {
      allowedPaths = extension === '.sln' || extension === '.slnx'
        ? this.solutionLoader.readProjectPaths(this.projectFilePath)
        : ['.csproj', '.vbproj', '.fsproj'].includes(extension)
          ? [this.projectFilePath]
          : [];
    } catch {
      return [];
    }
    return validateProjectTargets(selectedPaths, allowedPaths);
  }

  private createTask(command: string, args: (string | { value: string; quoting: vscode.ShellQuoting })[]): vscode.Task {
    return new vscode.Task(
      { type: 'dotnet', task: command },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
  }

  private loadProject(): void {
    const projectFileExtension = this.projectFilePath.toLowerCase().slice(this.projectFilePath.lastIndexOf('.'));
    const isSolution = projectFileExtension === '.sln' || projectFileExtension === '.slnx';
    const projectLoad = isSolution
      ? this.solutionLoader.loadAsync(this.projectFilePath).then((projectSet) => ({ type: 'project-set', data: projectSet } as ExtensionMessage))
      : this.projectFileLoader.loadProjectAsync(this.projectFilePath).then((project) => ({ type: 'project', data: project } as ExtensionMessage));

    projectLoad.then((message) => this.webview.postMessage(message));
  }

  private loadConfiguration(): void {
    this.configuredSources = [];
    this.log(`Loading sources for ${this.projectFilePath}`);
    this.nuGetConfigLoader
      .loadAsync(this.projectFilePath)
      .then((sources) => {
        const safeSources = sources.filter((source) => parseHttpUrl(source.url));
        this.configuredSources = safeSources;
        if (safeSources.length !== sources.length) {
          this.log(`Skipped ${sources.length - safeSources.length} NuGet source(s) with unsupported protocols or credentials in the URL.`);
        }
        const publicSources = redactPackageSourceCredentials(safeSources);
        const preferredSourceUrl = this.workspaceState.get<unknown>(WebviewMessageHandler.selectedSourceKey);
        let selectedSourceUrl: string | undefined;
        if (typeof preferredSourceUrl === 'string') {
          selectedSourceUrl = preferredSourceUrl === '' || safeSources.some((source) => source.url === preferredSourceUrl)
            ? preferredSourceUrl
            : '';
          if (selectedSourceUrl !== preferredSourceUrl) {
            void this.workspaceState.update(WebviewMessageHandler.selectedSourceKey, selectedSourceUrl);
          }
        } else if (preferredSourceUrl !== undefined) {
          void this.workspaceState.update(WebviewMessageHandler.selectedSourceKey, undefined);
        }
        const message: ExtensionMessage = { type: 'sources', data: publicSources, selectedSourceUrl };

        this.webview.postMessage(message);
      })
      .catch((error) => {
        this.log(`Error loading NuGet.Config: ${this.getErrorMessage(error)}`);
        vscode.window.showErrorMessage(`Error loading NuGet.Config: ${this.getErrorMessage(error)}`);
      });
  }

  private async saveSelectedSource(sourceUrl: unknown): Promise<void> {
    if (typeof sourceUrl !== 'string' || sourceUrl.length > 2048) {
      return;
    }
    if (sourceUrl !== '' && !this.configuredSources.some((source) => source.url === sourceUrl)) {
      return;
    }
    await this.workspaceState.update(WebviewMessageHandler.selectedSourceKey, sourceUrl);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private getErrorMessage(error: unknown): string {
    return formatErrorMessage(error);
  }

  private async handleNuGetHttpRequest(message: NuGetHttpRequestMessage): Promise<void> {
    const requestedUrl = parseHttpUrl(message.url);
    const sourceUrl = parseHttpUrl(message.sourceUrl);
    if (
      typeof message.requestId !== 'string' || message.requestId.length > 128 ||
      !requestedUrl || !sourceUrl || !isValidRequestHeaders(message.headers) ||
      !this.configuredSources.some((source) => source.url === message.sourceUrl)
    ) {
      if (typeof message.requestId === 'string' && message.requestId.length <= 128) {
        this.webview.postMessage({ type: 'nuget-http-response', requestId: message.requestId, statusCode: 0, error: 'Invalid NuGet request.' });
      }
      return;
    }
    const activeRequest: ActiveNuGetRequest = { cancelled: false, connections: new Set() };
    this.activeNuGetRequests.set(message.requestId, activeRequest);
    try {
      const configuredSource = this.configuredSources.find((source) => source.url === message.sourceUrl);
      const response = await this.requestText(requestedUrl, sourceUrl, message.headers, activeRequest, configuredSource?.authorizationHeader);
      if (activeRequest.cancelled) {
        return;
      }
      this.webview.postMessage({ type: 'nuget-http-response', requestId: message.requestId, ...response });
      this.log(`NuGet HTTP ${response.statusCode} ${this.sanitizeUrl(message.url)}`);
    } catch (error) {
      if (activeRequest.cancelled) {
        return;
      }
      const details = this.getErrorMessage(error);
      this.webview.postMessage({ type: 'nuget-http-response', requestId: message.requestId, statusCode: 0, error: details });
      this.log(`NuGet HTTP failed in ${this.sanitizeUrl(message.url)}: ${details}`);
    } finally {
      if (this.activeNuGetRequests.get(message.requestId) === activeRequest) {
        this.activeNuGetRequests.delete(message.requestId);
      }
    }
  }

  private cancelActiveNuGetRequests(): void {
    for (const activeRequest of this.activeNuGetRequests.values()) {
      activeRequest.cancelled = true;
      for (const connection of activeRequest.connections) {
        connection.destroy(new Error('NuGet request cancelled.'));
      }
      activeRequest.connections.clear();
    }
    this.activeNuGetRequests.clear();
  }

  private async requestText(
    url: URL,
    sourceUrl: URL,
    headers: Record<string, string>,
    activeRequest: ActiveNuGetRequest,
    authorizationHeader?: string,
    redirects = 0,
    originalOrigin = url.origin,
    authorizationAllowed = url.origin === sourceUrl.origin
  ): Promise<{ statusCode: number; statusMessage?: string; body: string }> {
    if (activeRequest.cancelled) {
      throw new Error('NuGet request cancelled.');
    }
    if (redirects > 5) {
      throw new Error('Too many redirects while contacting the NuGet source.');
    }
    const sameOriginAsSource = url.origin === sourceUrl.origin;
    const sameOriginAsInitial = url.origin === originalOrigin;
    const sendAuthorization = Boolean(
      authorizationHeader && sameOriginAsInitial && shouldSendSourceAuthorization(sourceUrl, url, authorizationAllowed)
    );
    const allowInsecureHttpCredentials = vscode.workspace
      .getConfiguration('nuget-assistant')
      .get<unknown>('allowInsecureHttpCredentials', false) === true;
    assertHttpCredentialsAllowed(url, sendAuthorization, allowInsecureHttpCredentials);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
    if (activeRequest.cancelled) {
      throw new Error('NuGet request cancelled.');
    }
    const selectedAddress = selectRequestAddress(addresses, sameOriginAsSource);
    if (!selectedAddress) {
      throw new Error('The NuGet source host could not be resolved.');
    }
    const transport = url.protocol === 'https:' ? https : http;
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'accept') {
        requestHeaders['accept'] = value;
      }
    }
    if (sendAuthorization && authorizationHeader) {
      requestHeaders['authorization'] = authorizationHeader;
    }
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      const request = transport.request(url, {
        method: 'GET',
        headers: requestHeaders,
        lookup: createPinnedAddressLookup(selectedAddress),
      }, (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(statusCode)) {
          response.resume();
          try {
            const redirectUrl = new URL(location, url);
            if ((redirectUrl.protocol !== 'http:' && redirectUrl.protocol !== 'https:') || redirectUrl.username || redirectUrl.password) {
              reject(new Error('The NuGet source returned an invalid redirect URL.'));
              return;
            }
            this.requestText(
              redirectUrl,
              sourceUrl,
              headers,
              activeRequest,
              authorizationHeader,
              redirects + 1,
              originalOrigin,
              authorizationAllowed && redirectUrl.origin === url.origin
            ).then(resolve, reject);
          } catch {
            reject(new Error('The NuGet source returned an invalid redirect URL.'));
          }
          return;
        }
        response.on('data', (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 5 * 1024 * 1024) {
            request.destroy(new Error('NuGet source response exceeded the 5 MB limit.'));
            return;
          }
          chunks.push(buffer);
        });
        response.on('end', () => resolve({ statusCode, statusMessage: response.statusMessage, body: Buffer.concat(chunks).toString('utf8') }));
      });
      activeRequest.connections.add(request);
      request.on('close', () => activeRequest.connections.delete(request));
      request.on('error', reject);
      request.end();
    });
  }

  private sanitizeUrl(value: string): string {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      return url.toString().replace(/(token|password|secret|key|auth)=([^&]+)/gi, '$1=[redacted]');
    } catch {
      return value;
    }
  }

  public dispose(): void {
    this.cancelActiveNuGetRequests();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
