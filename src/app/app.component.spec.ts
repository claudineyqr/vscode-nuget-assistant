import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AppComponent } from './app.component';
import { ExtensionMessage } from '../shared/models/extension-message';
import { PackageSource } from '../shared/models/package-source';
import { PackageManagerService } from './services/package-manager.service';
import { Project, ProjectSet } from '../shared/models/project';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  const currentPackageOperation = new BehaviorSubject<{ action: 'install' | 'update' | 'remove'; packageId: string } | null>(null);
  const packageManagerMock = {
    changeCurrentProject: jest.fn(),
    changeCurrentProjectSet: jest.fn(),
    changeCurrentSources: jest.fn(),
    refreshCurrentPackages: jest.fn(),
    cancelCurrentPackageOperation: jest.fn(),
    changeCurrentPackageOperation: jest.fn((operation) => currentPackageOperation.next(operation)),
    currentPackageOperation,
  };

  beforeEach(
    waitForAsync(() => {
      TestBed.configureTestingModule({
        imports: [AppComponent, CommonModule],
        providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
        schemas: [NO_ERRORS_SCHEMA],
      })
        .overrideComponent(AppComponent, {
          set: {
            imports: [CommonModule],
            template: '<div class="shell"></div>',
          },
        })
        .compileComponents();
    })
  );

  beforeEach(() => {
    jest.clearAllMocks();
    currentPackageOperation.next(null);
    fixture = TestBed.createComponent(AppComponent);
    component = fixture.debugElement.componentInstance;
    fixture.detectChanges();
  });

  test('should create the app', () => {
    expect(component).toBeTruthy();
  });

  test('should call change current project', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: {
        type: 'project',
        data: {
          name: 'TestProject',
          fsPath: 'test/path',
          packages: [],
        } as Project,
      },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.changeCurrentProject.mock.calls[0][0]).toEqual(event.data.data);
  });

  test('should call change current sources', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: {
        type: 'sources',
        data: [
          {
            name: 'TestSource',
            url: 'www.test.com',
          },
        ] as PackageSource[],
      },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.changeCurrentSources.mock.calls[0][0]).toEqual(event.data.data);
  });

  test('forwards the selected package source URL with the source list', () => {
    const sources: PackageSource[] = [{ name: 'Private', url: 'https://packages.example/v3/index.json', authorizationHeader: undefined }];
    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'sources', data: sources, selectedSourceUrl: sources[0].url },
    }));

    expect(packageManagerMock.changeCurrentSources).toHaveBeenCalledWith(sources, sources[0].url);
  });

  test('should refresh current packages when the extension reports completed package operations', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'packages-changed' },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.refreshCurrentPackages).toHaveBeenCalledWith(true);
  });

  test.each([
    ['project', { type: 'project', data: { name: 'App.csproj', fsPath: '/App.csproj', packages: [] } as Project }],
    ['solution', { type: 'project-set', data: { name: 'App.sln', fsPath: '/App.sln', projects: [] } as ProjectSet }],
  ] as const)('refreshes the active package query after receiving the updated %s state', (_scope, projectMessage) => {
    const changeProject = projectMessage.type === 'project'
      ? packageManagerMock.changeCurrentProject
      : packageManagerMock.changeCurrentProjectSet;
    const event = new MessageEvent<ExtensionMessage>('message', { data: projectMessage });
    window.dispatchEvent(event);

    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'packages-changed' },
    }));

    expect(changeProject).toHaveBeenCalledWith(projectMessage.data);
    expect(packageManagerMock.refreshCurrentPackages).toHaveBeenCalledWith(true);
    expect(changeProject.mock.invocationCallOrder[0]).toBeLessThan(packageManagerMock.refreshCurrentPackages.mock.invocationCallOrder[0]);
  });

  test('tracks package operation progress and clears it on completion', () => {
    const operation = { action: 'update' as const, packageId: 'Contoso.Widget' };
    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-progress', operation },
    }));
    expect(packageManagerMock.changeCurrentPackageOperation).toHaveBeenCalledWith(operation);

    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-complete' },
    }));
    expect(packageManagerMock.changeCurrentPackageOperation).toHaveBeenLastCalledWith(null);
  });
});
