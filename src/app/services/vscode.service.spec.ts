import { TestBed } from '@angular/core/testing';

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
});
