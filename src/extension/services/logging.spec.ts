jest.mock('vscode', () => ({
  workspace: { getConfiguration: jest.fn() },
}), { virtual: true });

import * as vscode from 'vscode';
import WebviewMessageHandler from './webview-message-handler';

describe('WebviewMessageHandler logging levels', () => {
  let level: string | undefined;
  let bodyLimitKb: unknown;
  let appendLine: jest.Mock;
  let handler: {
    handleMessage(message: unknown): void;
    log(message: string): void;
    logError(message: string): void;
    logHttpResponse(statusCode: number, sanitizedUrl: string): void;
    logHttpDebug(message: string): void;
    getDebugResponseBodyLimitKb(): number;
    truncateResponseBody(body: string): { text: string; truncated: boolean; byteLength: number; limitKb: number };
    formatDebugResponse(statusCode: number, statusMessage: string | undefined, url: string, durationMs: number, body: string): string;
  };

  beforeEach(() => {
    level = undefined;
    bodyLimitKb = undefined;
    appendLine = jest.fn();
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (key === 'loggingLevel') {
          return level === undefined ? defaultValue : level;
        }
        if (key === 'debugResponseBodyLimitKb') {
          return bodyLimitKb === undefined ? defaultValue : bodyLimitKb;
        }
        return defaultValue;
      }),
    });
    handler = Object.assign(Object.create(WebviewMessageHandler.prototype), {
      outputChannel: { appendLine },
    });
  });

  it('defaults to None and suppresses all log messages', () => {
    handler.log('existing event');
    handler.logError('network failure');
    handler.logHttpResponse(404, 'https://feed.test/index.json');

    expect(appendLine).not.toHaveBeenCalled();
  });

  it('logs only failed HTTP calls at Error level', () => {
    level = 'Error';
    handler.log('existing event');
    handler.logError('network failure');
    handler.logHttpResponse(200, 'https://feed.test/index.json');
    handler.logHttpResponse(503, 'https://feed.test/index.json');

    expect(appendLine).toHaveBeenCalledTimes(2);
    expect(appendLine.mock.calls[0][0]).toContain('network failure');
    expect(appendLine.mock.calls[1][0]).toContain('NuGet HTTP 503');
  });

  it('records parsing diagnostics as errors and filters informational diagnostics at Error level', () => {
    level = 'Error';
    handler.handleMessage({ command: 'nuget-diagnostic', message: 'Invalid JSON', severity: 'error' });
    handler.handleMessage({ command: 'nuget-diagnostic', message: 'Request started', severity: 'information' });

    expect(appendLine).toHaveBeenCalledTimes(1);
    expect(appendLine.mock.calls[0][0]).toContain('Invalid JSON');
  });

  it('applies level changes immediately and emits debug details only in Debug', () => {
    handler.logHttpDebug('HTTP response body');
    level = 'Debug';
    handler.logHttpDebug('HTTP response body');

    expect(appendLine).toHaveBeenCalledTimes(1);
    expect(appendLine.mock.calls[0][0]).toContain('DEBUG HTTP response body');
  });

  it('uses the configured body limit and preserves the 32 KB default', () => {
    const truncated = handler.truncateResponseBody('x'.repeat(10 * 1024));
    const complete = handler.truncateResponseBody('short response');

    expect(Buffer.byteLength(truncated.text, 'utf8')).toBe(10 * 1024);
    expect(truncated).toMatchObject({ truncated: false, byteLength: 10 * 1024, limitKb: 32 });
    expect(complete).toMatchObject({ text: 'short response', truncated: false, limitKb: 32 });

    bodyLimitKb = 2;
    const customLimit = handler.truncateResponseBody('x'.repeat(10 * 1024));
    expect(Buffer.byteLength(customLimit.text, 'utf8')).toBe(2 * 1024);
    expect(customLimit.limitKb).toBe(2);

    bodyLimitKb = 1;
    const unicodeLimit = handler.truncateResponseBody(`${'x'.repeat(1023)}😀`);
    expect(Buffer.byteLength(unicodeLimit.text, 'utf8')).toBeLessThanOrEqual(1024);
  });

  it('omits the body at zero while retaining HTTP response metadata', () => {
    bodyLimitKb = 0;
    const debugLine = handler.formatDebugResponse(200, 'OK', 'https://feed.test/index.json', 12, 'response body');

    expect(debugLine).toContain('HTTP response 200 OK');
    expect(debugLine).toContain('https://feed.test/index.json');
    expect(debugLine).toContain('12 ms');
    expect(debugLine).toContain('body 13 bytes (omitted; limit 0 KB)');
    expect(debugLine).not.toContain('response body');
  });

  it('floors fractional limits and falls back to 32 for invalid values', () => {
    bodyLimitKb = 1.9;
    expect(handler.getDebugResponseBodyLimitKb()).toBe(1);

    for (const invalidValue of ['invalid', Number.NaN, Number.POSITIVE_INFINITY]) {
      bodyLimitKb = invalidValue;
      expect(handler.getDebugResponseBodyLimitKb()).toBe(32);
    }

    bodyLimitKb = -3;
    expect(handler.getDebugResponseBodyLimitKb()).toBe(0);
    bodyLimitKb = 2048;
    expect(handler.getDebugResponseBodyLimitKb()).toBe(2048);
    bodyLimitKb = 6000;
    expect(handler.getDebugResponseBodyLimitKb()).toBe(5120);
  });

  it('declares the supported setting values and None default', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const packageJson = require('../../../package.json') as {
      contributes: { configuration: { properties: Record<string, { default: unknown; enum?: string[]; minimum?: number; maximum?: number }> } };
    };
    const properties = packageJson.contributes.configuration.properties;
    const setting = properties['nuget-assistant.loggingLevel'];
    const bodyLimitSetting = properties['nuget-assistant.debugResponseBodyLimitKb'];

    expect(setting.default).toBe('None');
    expect(setting.enum).toEqual(['None', 'Information', 'Error', 'Debug']);
    expect(bodyLimitSetting).toMatchObject({ default: 32, minimum: 0, maximum: 5120 });
  });
});
