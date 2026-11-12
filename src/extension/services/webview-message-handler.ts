import { ExtensionMessage } from '../../shared/models/extension-message';
import { InstallMessage, InstallPackagesMessage, NuGetHttpRequestMessage, UninstallMessage } from '../../shared/models/ui-message';
import { formatErrorMessage } from '../../shared/utils/error-message';
import { localize } from './localization';
import { isNuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';
import * as vscode from 'vscode';
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as path from 'node:path';
import { decodeNuGetResponseBody } from './nuget-response';

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

interface NuGetRequestContext {
  authorizationHeader?: string;
  redirects: number;
  originalOrigin: string;
  authorizationAllowed: boolean;
}

enum LoggingLevel {
  None = 'None',
  Information = 'Information',
  Error = 'Error',
  Debug = 'Debug',
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
    this.taskManager = new TaskManager(
      (operation) => this.webview.postMessage({ type: 'package-operation-progress', operation }),
      () => this.reloadProjectAfterPackageOperations(),
      (error, operation) => {
        const details = this.getErrorMessage(error);
        this.logHandledError(`Error starting package operation for ${operation.packageId}: ${details}`, error);
        vscode.window.showErrorMessage(localize('error.startPackageOperation', operation.packageId, details));
      }
    );

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
      case 'add-packages':
        this.addPackages(message as unknown as InstallPackagesMessage);
        return;
      case 'remove-package':
        this.removePackage(message as unknown as UninstallMessage);
        return;
      case 'cancel-package-operation':
        this.taskManager.cancelTasks();
        return;
      case 'load-project':
        void this.loadProject().catch((error) => {
          const details = this.getErrorMessage(error);
          this.logHandledError(`Error loading project: ${details}`, error);
          vscode.window.showErrorMessage(localize('error.loadProject', details));
        });
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
          const diagnostic = this.getErrorMessage(message['message']);
          if (message['severity'] === 'error') {
            this.logError(diagnostic);
          } else {
            this.log(diagnostic);
          }
        }
        return;
      case 'nuget-http-request':
        void this.handleNuGetHttpRequest(message as unknown as NuGetHttpRequestMessage);
        return;
    }
  }

  private addPackage(message: InstallMessage): void {
    const source = this.configuredSources.some((candidate) => candidate.url === message.packageSourceUrl);
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

      this.taskManager.executeTask(this.createTask('add', args), {
        action: message.operation ?? 'install',
        packageId: message.packageId,
      });
    });
  }

  private addPackages(message: InstallPackagesMessage): void {
    if (!Array.isArray(message.packages)) {
      return;
    }
    message.packages.forEach((packageMessage) => {
      if (isRecord(packageMessage)) {
        this.addPackage(packageMessage);
      }
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
      this.taskManager.executeTask(this.createTask('remove', args), {
        action: 'remove',
        packageId: message.packageId,
      });
    });
  }

  private getValidatedProjectPaths(message: UninstallMessage): string[] {
    const selectedPaths = message.projectPaths ?? (typeof message.projectName === 'string' ? [message.projectName] : []);
    const extension = path.extname(this.projectFilePath).toLowerCase();
    let allowedPaths: string[];
    try {
    if (extension === '.sln' || extension === '.slnx') {
      allowedPaths = this.solutionLoader.readProjectPaths(this.projectFilePath);
    } else if (['.csproj', '.vbproj', '.fsproj'].includes(extension)) {
      allowedPaths = [this.projectFilePath];
    } else {
      allowedPaths = [];
    }
    } catch {
      return [];
    }
    return validateProjectTargets(selectedPaths, allowedPaths);
  }

  private createTask(command: string, args: (string | { value: string; quoting: vscode.ShellQuoting })[]): vscode.Task {
    const task = new vscode.Task(
      { type: 'dotnet', task: command },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
    task.presentationOptions = {
      reveal: vscode.TaskRevealKind.Always,
      focus: false,
    };
    return task;
  }

  private async loadProject(): Promise<void> {
    const projectFileExtension = this.projectFilePath.toLowerCase().slice(this.projectFilePath.lastIndexOf('.'));
    const isSolution = projectFileExtension === '.sln' || projectFileExtension === '.slnx';
    const projectLoad: Promise<ExtensionMessage> = isSolution
      ? this.solutionLoader.loadAsync(this.projectFilePath).then((projectSet) => ({ type: 'project-set', data: projectSet } satisfies ExtensionMessage))
      : this.projectFileLoader.loadProjectAsync(this.projectFilePath).then((project) => ({ type: 'project', data: project } satisfies ExtensionMessage));

    const message = await projectLoad;
    await this.webview.postMessage(message);
  }

  private async reloadProjectAfterPackageOperations(): Promise<void> {
    try {
      await this.loadProject();
      await this.webview.postMessage({ type: 'packages-changed' });
    } catch (error) {
      const details = this.getErrorMessage(error);
      this.logHandledError(`Error reloading project after package operations: ${details}`, error);
      vscode.window.showErrorMessage(localize('error.reloadProject', details));
    } finally {
      await this.webview.postMessage({ type: 'package-operation-complete' });
    }
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
        this.logHandledError(`Error loading NuGet.Config: ${this.getErrorMessage(error)}`, error);
        vscode.window.showErrorMessage(localize('error.loadNugetConfig', this.getErrorMessage(error)));
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
    const level = this.getLoggingLevel();
    if (level === LoggingLevel.None || level === LoggingLevel.Error) {
      return;
    }
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private getLoggingLevel(): LoggingLevel {
    const configuredLevel = vscode.workspace
      .getConfiguration('nuget-assistant')
      .get<unknown>('loggingLevel', LoggingLevel.None);
    switch (configuredLevel) {
      case LoggingLevel.Information:
      case LoggingLevel.Error:
      case LoggingLevel.Debug:
        return configuredLevel;
      default:
        return LoggingLevel.None;
    }
  }

  private logError(message: string): void {
    if (this.getLoggingLevel() === LoggingLevel.None) {
      return;
    }
    this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  private logHandledError(message: string, error: unknown): void {
    if (isNuGetDataParsingError(error)) {
      this.logError(message);
    } else {
      this.log(message);
    }
  }

  private logHttpDebug(message: string): void {
    if (this.getLoggingLevel() === LoggingLevel.Debug) {
      this.outputChannel.appendLine(`[${new Date().toISOString()}] DEBUG ${message}`);
    }
  }

  private logHttpResponse(statusCode: number, sanitizedUrl: string): void {
    const message = `NuGet HTTP ${statusCode} ${sanitizedUrl}`;
    const level = this.getLoggingLevel();
    if (level === LoggingLevel.Information || level === LoggingLevel.Debug) {
      this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    } else if (statusCode < 200 || statusCode >= 300) {
      this.logError(message);
    }
  }

  private getDebugResponseBodyLimitKb(): number {
    const configuredLimit = vscode.workspace
      .getConfiguration('nuget-assistant')
      .get<unknown>('debugResponseBodyLimitKb', 32);
    if (typeof configuredLimit !== 'number' || !Number.isFinite(configuredLimit)) {
      return 32;
    }
    return Math.max(0, Math.min(5120, Math.floor(configuredLimit)));
  }

  private truncateResponseBody(body: string): { text: string; truncated: boolean; byteLength: number; limitKb: number } {
    const bytes = Buffer.from(body, 'utf8');
    const limitKb = this.getDebugResponseBodyLimitKb();
    const limitBytes = limitKb * 1024;
    const truncated = bytes.length > limitBytes;
    let text = truncated ? bytes.subarray(0, limitBytes).toString('utf8') : body;
    while (truncated && Buffer.byteLength(text, 'utf8') > limitBytes) {
      text = text.slice(0, -1);
    }
    return { text, truncated, byteLength: bytes.length, limitKb };
  }

  private formatDebugResponse(statusCode: number, statusMessage: string | undefined, sanitizedUrl: string, durationMs: number, body: string): string {
    const loggedBody = this.truncateResponseBody(body);
    let bodyDetails: string;
    if (loggedBody.limitKb === 0) {
      bodyDetails = `body ${loggedBody.byteLength} bytes (omitted; limit 0 KB)`;
    } else {
      const truncationNotice = loggedBody.truncated ? ` (truncated to ${loggedBody.limitKb} KB)` : '';
      bodyDetails = `body ${loggedBody.byteLength} bytes${truncationNotice}:\n${loggedBody.text}`;
    }
    return `HTTP response ${statusCode} ${statusMessage ?? ''} from ${sanitizedUrl} in ${durationMs} ms; ${bodyDetails}`;
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
      const response = await this.requestText(requestedUrl, sourceUrl, message.headers, activeRequest, {
        authorizationHeader: configuredSource?.authorizationHeader,
        redirects: 0,
        originalOrigin: requestedUrl.origin,
        authorizationAllowed: requestedUrl.origin === sourceUrl.origin,
      });
      if (activeRequest.cancelled) {
        return;
      }
      this.webview.postMessage({ type: 'nuget-http-response', requestId: message.requestId, ...response });
      const sanitizedUrl = this.sanitizeUrl(message.url);
      this.logHttpResponse(response.statusCode, sanitizedUrl);
    } catch (error) {
      if (activeRequest.cancelled) {
        return;
      }
      const details = this.getErrorMessage(error);
      this.webview.postMessage({ type: 'nuget-http-response', requestId: message.requestId, statusCode: 0, error: details });
      this.logError(`NuGet HTTP failed in ${this.sanitizeUrl(message.url)}: ${details}`);
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
    context: NuGetRequestContext
  ): Promise<{ statusCode: number; statusMessage?: string; body: string }> {
    const { authorizationHeader, redirects, originalOrigin, authorizationAllowed } = context;
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
    const sanitizedUrl = this.sanitizeUrl(url.toString());
    const requestStartedAt = Date.now();
    this.logHttpDebug(`HTTP GET ${sanitizedUrl}`);
    const requestHeaders: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() === 'accept') {
        requestHeaders['accept'] = value;
      }
    }
    requestHeaders['accept-encoding'] = 'gzip';
    if (sendAuthorization && authorizationHeader) {
      requestHeaders['authorization'] = authorizationHeader;
    }
    return new Promise((resolve, reject) => {
      const request = transport.request(url, {
        method: 'GET',
        headers: requestHeaders,
        lookup: createPinnedAddressLookup(selectedAddress),
      }, (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (location && [301, 302, 303, 307, 308].includes(statusCode)) {
          this.logHttpDebug(`HTTP response ${statusCode} ${response.statusMessage ?? ''} from ${sanitizedUrl} in ${Date.now() - requestStartedAt} ms; redirecting.`.trim());
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
              {
                ...context,
                redirects: redirects + 1,
                originalOrigin,
                authorizationAllowed: authorizationAllowed && redirectUrl.origin === url.origin,
              }
            ).then(resolve, reject);
          } catch {
            reject(new Error('The NuGet source returned an invalid redirect URL.'));
          }
          return;
        }
        this.readResponseBody(response, request, sanitizedUrl, requestStartedAt).then(resolve, reject);
      });
      activeRequest.connections.add(request);
      request.on('close', () => activeRequest.connections.delete(request));
      request.on('error', (error) => {
        this.logHttpDebug(`HTTP request failed for ${sanitizedUrl} in ${Date.now() - requestStartedAt} ms: ${this.getErrorMessage(error)}`);
        reject(error);
      });
      request.end();
    });
  }

  private readResponseBody(
    response: http.IncomingMessage,
    request: http.ClientRequest,
    sanitizedUrl: string,
    requestStartedAt: number
  ): Promise<{ statusCode: number; statusMessage?: string; body: string }> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 5 * 1024 * 1024) {
          request.destroy(new Error('NuGet source response exceeded the 5 MB limit.'));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        void this.finishResponse(response, chunks, sanitizedUrl, requestStartedAt).then(resolve, reject);
      });
    });
  }

  private async finishResponse(
    response: http.IncomingMessage,
    chunks: Buffer[],
    sanitizedUrl: string,
    requestStartedAt: number
  ): Promise<{ statusCode: number; statusMessage?: string; body: string }> {
    const decodedBody = await decodeNuGetResponseBody(Buffer.concat(chunks), response.headers['content-encoding']);
    if (decodedBody.length > 5 * 1024 * 1024) {
      throw new Error('NuGet source response exceeded the 5 MB limit after decompression.');
    }
    const body = decodedBody.toString('utf8');
    if (this.getLoggingLevel() === LoggingLevel.Debug) {
      this.logHttpDebug(
        this.formatDebugResponse(response.statusCode ?? 0, response.statusMessage, sanitizedUrl, Date.now() - requestStartedAt, body)
      );
    }
    return { statusCode: response.statusCode ?? 0, statusMessage: response.statusMessage, body };
  }

  private sanitizeUrl(value: string): string {
    try {
      const url = new URL(value);
      url.username = '';
      url.password = '';
      for (const key of url.searchParams.keys()) {
        if (/(token|password|secret|api[_-]?key|auth|credential|signature)/i.test(key)) {
          url.searchParams.set(key, '[redacted]');
        }
      }
      return url.toString();
    } catch {
      return value;
    }
  }

  public dispose(): void {
    this.taskManager.dispose();
    this.cancelActiveNuGetRequests();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
