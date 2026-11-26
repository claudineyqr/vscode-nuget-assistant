import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';

import { NuGetConfigSnapshot } from '../../shared/models/nuget-config';
import { NuGetConfigService } from './nuget-config.service';
import { VscodeService } from './vscode.service';

describe('NuGetConfigService', () => {
  let service: NuGetConfigService;
  let vscodeServiceMock: { postMessage: jest.Mock; postMessages: jest.Mock };

  const snapshot: NuGetConfigSnapshot = {
    files: [{ path: 'C:\\NuGet.Config', kind: 'user', exists: true }],
    selectedFilePath: 'C:\\NuGet.Config',
    fileExists: true,
    sources: [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true, hasPassword: false }],
  };

  beforeEach(() => {
    vscodeServiceMock = { postMessage: jest.fn(), postMessages: jest.fn() };
    TestBed.configureTestingModule({
      providers: [{ provide: VscodeService, useValue: vscodeServiceMock }],
    });
    service = TestBed.inject(NuGetConfigService);
  });

  test('requests the configuration when created', () => {
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({ command: 'load-nuget-config', filePath: undefined });
  });

  test('loads a specific configuration file', () => {
    vscodeServiceMock.postMessage.mockClear();

    service.load('C:\\repo\\NuGet.Config');

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({
      command: 'load-nuget-config',
      filePath: 'C:\\repo\\NuGet.Config',
    });
  });

  test('sends the edited sources to the extension', () => {
    const sources = [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json', enabled: true }];

    service.save('C:\\NuGet.Config', sources);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({
      command: 'save-nuget-config',
      filePath: 'C:\\NuGet.Config',
      sources,
    });
  });

  test('applies snapshots and errors to the observable state', async () => {
    service.changeConfig(snapshot);
    expect(await firstValueFrom(service.config)).toBe(snapshot);
    expect(await firstValueFrom(service.loading)).toBe(false);

    service.changeError('Invalid configuration');
    expect(await firstValueFrom(service.error)).toBe('Invalid configuration');
    expect(await firstValueFrom(service.loading)).toBe(false);
  });
});
