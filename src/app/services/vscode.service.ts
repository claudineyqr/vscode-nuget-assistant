import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { NuGetHttpRequestMessage, UIMessage } from '../../shared/models/ui-message';
import { formatErrorMessage } from '../../shared/utils/error-message';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

@Injectable({
  providedIn: 'root',
})
export class VscodeService {
  private requestId = 0;

  public postMessage(message: UIMessage) {
    vscode.postMessage(message);
  }

  public postMessages(messages: UIMessage[]) {
    messages.forEach((m) => this.postMessage(m));
  }

  public requestText(url: string, sourceUrl: string, headers: Record<string, string>): Observable<string> {
    return new Observable<string>((subscriber) => {
      const requestId = `nuget-${Date.now()}-${++this.requestId}`;
      const onMessage = (event: MessageEvent) => {
        const response = event.data;
        if (response?.type !== 'nuget-http-response' || response.requestId !== requestId) {
          return;
        }
        window.removeEventListener('message', onMessage);
        if (response.error || response.statusCode < 200 || response.statusCode >= 300) {
          const status = response.statusCode ? `HTTP ${response.statusCode} ${response.statusMessage ?? ''}`.trim() : 'network error';
          subscriber.error(new Error(`${status}: ${formatErrorMessage(response.error ?? 'request failed')}`));
          return;
        }
        subscriber.next(String(response.body ?? ''));
        subscriber.complete();
      };

      window.addEventListener('message', onMessage);
      this.postMessage({ command: 'nuget-http-request', requestId, url, sourceUrl, headers } as NuGetHttpRequestMessage);
      return () => window.removeEventListener('message', onMessage);
    });
  }
}
