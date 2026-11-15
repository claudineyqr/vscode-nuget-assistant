import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { VscodeService } from './vscode.service';

const vscodeApi = (window as unknown as { acquireVsCodeApi: () => { postMessage: jest.Mock } }).acquireVsCodeApi();

describe('VscodeService', () => {
  let service: VscodeService;

  beforeEach(() => {
    vscodeApi.postMessage.mockClear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(VscodeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('ignores NuGet responses from a different origin', () => {
    const next = jest.fn();
    const subscription = service.requestText('https://feed.example.test', 'https://feed.example.test', {}).subscribe(next);
    const request = vscodeApi.postMessage.mock.calls.at(-1)?.[0] as { requestId: string };

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: 'https://untrusted.example.test',
        data: { type: 'nuget-http-response', requestId: request.requestId, body: 'untrusted' },
      })
    );
    expect(next).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: 'nuget-http-response', requestId: request.requestId, body: 'trusted' },
      })
    );
    expect(next).toHaveBeenCalledWith('trusted');
    subscription.unsubscribe();
  });

  it.each([
    [{ statusCode: 401, statusMessage: 'Unauthorized', body: 'denied' }, 'HTTP 401 Unauthorized'],
    [{ statusCode: 0, error: 'DNS lookup failed' }, 'network error: DNS lookup failed'],
  ])('reports failed NuGet responses to the caller', async (response, expectedMessage) => {
    const request = firstValueFrom(service.requestText('https://feed.example.test', 'https://feed.example.test', {}));
    const requestId = (vscodeApi.postMessage.mock.calls.at(-1)?.[0] as { requestId: string }).requestId;

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'nuget-http-response', requestId, ...response },
    }));

    await expect(request).rejects.toThrow(expectedMessage);
  });

  it('ignores responses for other requests and removes its listener on unsubscribe', () => {
    const next = jest.fn();
    const subscription = service.requestText('https://feed.example.test', 'https://feed.example.test', {}).subscribe(next);
    const requestId = (vscodeApi.postMessage.mock.calls.at(-1)?.[0] as { requestId: string }).requestId;

    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'nuget-http-response', requestId: 'another-request', statusCode: 200, body: 'wrong' },
    }));
    expect(next).not.toHaveBeenCalled();

    subscription.unsubscribe();
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'nuget-http-response', requestId, statusCode: 200, body: 'after unsubscribe' },
    }));
    expect(next).not.toHaveBeenCalled();
  });
});
