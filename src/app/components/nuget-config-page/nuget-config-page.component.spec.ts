import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject, Observable } from 'rxjs';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';

import { NuGetConfigSnapshot } from '../../../shared/models/nuget-config';
import { NuGetConfigService } from '../../services/nuget-config.service';
import { NuGetConfigPageComponent } from './nuget-config-page.component';

describe('NuGetConfigPageComponent', () => {
  let fixture: ComponentFixture<NuGetConfigPageComponent>;
  let component: NuGetConfigPageComponent;
  let config: BehaviorSubject<NuGetConfigSnapshot | null>;
  let loading: BehaviorSubject<boolean>;
  let saving: BehaviorSubject<boolean>;
  let configError: BehaviorSubject<string | null>;
  const configServiceMock: {
    config: Observable<NuGetConfigSnapshot | null>;
    loading: Observable<boolean>;
    saving: Observable<boolean>;
    error: Observable<string | null>;
    load: jest.Mock;
    save: jest.Mock;
    changeConfig: jest.Mock;
    changeSaved: jest.Mock;
    changeError: jest.Mock;
  } = {
    config: new BehaviorSubject<NuGetConfigSnapshot | null>(null).asObservable(),
    loading: new BehaviorSubject<boolean>(false).asObservable(),
    saving: new BehaviorSubject<boolean>(false).asObservable(),
    error: new BehaviorSubject<string | null>(null).asObservable(),
    load: jest.fn(),
    save: jest.fn(),
    changeConfig: jest.fn(),
    changeSaved: jest.fn(),
    changeError: jest.fn(),
  };

  const snapshot: NuGetConfigSnapshot = {
    files: [
      { path: 'C:\\Users\\Dev\\AppData\\Roaming\\NuGet\\NuGet.Config', kind: 'user', exists: true },
      { path: 'C:\\repo\\NuGet.Config', kind: 'project', exists: true },
    ],
    selectedFilePath: 'C:\\Users\\Dev\\AppData\\Roaming\\NuGet\\NuGet.Config',
    fileExists: true,
    sources: [
      {
        name: 'nuget.org',
        url: 'https://api.nuget.org/v3/index.json',
        enabled: true,
        hasPassword: false,
      },
      {
        name: 'Private',
        url: 'https://private.example/v3/index.json',
        enabled: true,
        username: 'user',
        hasPassword: true,
      },
    ],
  };

  beforeEach(async () => {
    config = new BehaviorSubject<NuGetConfigSnapshot | null>(null);
    loading = new BehaviorSubject<boolean>(false);
    saving = new BehaviorSubject<boolean>(false);
    configError = new BehaviorSubject<string | null>(null);
    jest.clearAllMocks();
    configServiceMock.config = config.asObservable();
    configServiceMock.loading = loading.asObservable();
    configServiceMock.saving = saving.asObservable();
    configServiceMock.error = configError.asObservable();

    await TestBed.configureTestingModule({
      imports: [NuGetConfigPageComponent, ReactiveFormsModule],
      providers: [{ provide: NuGetConfigService, useValue: configServiceMock }],
    }).compileComponents();

    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    fixture = TestBed.createComponent(NuGetConfigPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders a standalone page without modal markup', () => {
    expect(fixture.nativeElement.querySelector('.dialog-backdrop')).toBeNull();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[aria-labelledby="nuget-config-title"]')).not.toBeNull();
  });

  it('routes extension messages into the configuration state', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'nuget-config', data: snapshot },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'nuget-config-saved', data: snapshot },
    }));
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'nuget-config-error', error: 'Invalid configuration' },
    }));

    expect(configServiceMock.changeConfig).toHaveBeenCalledWith(snapshot);
    expect(configServiceMock.changeSaved).toHaveBeenCalledWith(snapshot);
    expect(configServiceMock.changeError).toHaveBeenCalledWith('Invalid configuration');
  });

  it('applies a loaded snapshot without exposing credentials', () => {
    config.next(snapshot);
    fixture.detectChanges();

    expect(component.selectedFilePath).toBe(snapshot.selectedFilePath);
    expect(component.sources).toHaveLength(2);
    expect(component.sources[1].username).toBe('user');
    expect(component.sources[1].hasPassword).toBe(true);
    expect(component.isDirty).toBe(false);
  });

  it('adds a source and sends credentials on save', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startAdd();
    component.sourceForm.setValue({
      name: 'New feed',
      url: 'https://new.example/v3/index.json',
      enabled: true,
      username: 'new-user',
      password: 'new-pass',
      removeCredentials: false,
    });
    component.applySource();

    expect(component.sources).toHaveLength(3);
    expect(component.sources[2]).toMatchObject({
      name: 'New feed',
      url: 'https://new.example/v3/index.json',
      username: 'new-user',
      hasPassword: true,
      credentialAction: 'replace',
    });

    component.save();

    expect(configServiceMock.save).toHaveBeenCalledWith(snapshot.selectedFilePath, [
      expect.objectContaining({ name: 'nuget.org' }),
      expect.objectContaining({ name: 'Private' }),
      expect.objectContaining({
        name: 'New feed',
        credentials: { action: 'replace', username: 'new-user', password: 'new-pass' },
      }),
    ]);
  });

  it('keeps an existing password when the password field is left blank', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startEdit(component.sources[1], 1);
    component.sourceForm.patchValue({
      name: 'Private',
      url: 'https://private.example/v3/index.json?updated=1',
      enabled: true,
      username: 'user',
      password: '',
      removeCredentials: false,
    });
    component.applySource();

    expect(component.sources[1]).toMatchObject({
      credentialAction: 'keep',
      hasPassword: true,
    });
    expect(component.isDirty).toBe(true);

    component.save();

    expect(configServiceMock.save).toHaveBeenCalledWith(
      snapshot.selectedFilePath,
      expect.arrayContaining([
        expect.objectContaining({ name: 'Private', credentials: { action: 'keep' } }),
      ])
    );
  });

  it('removes stored credentials when requested', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startEdit(component.sources[1], 1);
    component.sourceForm.patchValue({
      removeCredentials: true,
      username: 'user',
      password: '',
    });
    component.applySource();

    expect(component.sources[1]).toMatchObject({
      credentialAction: 'remove',
      hasPassword: false,
    });
  });

  it('reorders sources and marks the page dirty', () => {
    config.next(snapshot);
    fixture.detectChanges();

    const originalNames = component.sources.map((source) => source.name);
    component.moveSource(1, -1);

    expect(component.sources.map((source) => source.name)).toEqual([originalNames[1], originalNames[0]]);
    expect(component.isDirty).toBe(true);

    component.moveSource(0, -1);
    component.moveSource(1, 1);
    expect(component.sources.map((source) => source.name)).toEqual([originalNames[1], originalNames[0]]);
  });

  it('keeps the source dialog open on Escape', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startAdd();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(component.editing).not.toBeNull();
  });

  it('rejects duplicate source names', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startAdd();
    component.sourceForm.setValue({
      name: 'nuget.org',
      url: 'https://duplicate.example/v3/index.json',
      enabled: true,
      username: '',
      password: '',
      removeCredentials: false,
    });
    component.applySource();

    expect(component.sources).toHaveLength(2);
    expect(component.sourceForm.get('name')?.hasError('duplicate')).toBe(true);
  });

  it('asks before discarding changes when switching files', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startAdd();
    component.sourceForm.setValue({
      name: 'New feed',
      url: 'https://new.example/v3/index.json',
      enabled: true,
      username: '',
      password: '',
      removeCredentials: false,
    });
    component.applySource();

    component.requestFileChange('C:\\repo\\NuGet.Config');

    expect(component.pendingFilePath).toBe('C:\\repo\\NuGet.Config');
    expect(component.fileControl.value).toBe(snapshot.selectedFilePath);

    component.confirmDiscard();

    expect(configServiceMock.load).toHaveBeenCalledWith('C:\\repo\\NuGet.Config');
  });

  it('shows extension errors and restores the selected file', () => {
    config.next(snapshot);
    fixture.detectChanges();

    configError.next('The configuration file is not valid.');

    expect(component.errorMessage).toBe('The configuration file is not valid.');
    expect(component.fileControl.value).toBe(snapshot.selectedFilePath);
  });

  it('reloads the selected file when cancelled, without leaving the page', () => {
    config.next(snapshot);
    fixture.detectChanges();

    component.startAdd();
    component.sourceForm.setValue({
      name: 'New feed',
      url: 'https://new.example/v3/index.json',
      enabled: true,
      username: '',
      password: '',
      removeCredentials: false,
    });
    component.applySource();
    expect(component.isDirty).toBe(true);

    component.cancel();

    expect(configServiceMock.load).toHaveBeenCalledWith(snapshot.selectedFilePath);
    expect(component.pendingFilePath).toBeNull();
  });
});
