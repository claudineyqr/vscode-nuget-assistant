import { NO_ERRORS_SCHEMA } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ComponentFixture, TestBed, waitForAsync } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AppComponent } from './app.component';
import { ExtensionMessage } from '../shared/models/extension-message';
import { PackageSource } from '../shared/models/package-source';
import { PackageManagerService } from './services/package-manager.service';
import { Project } from '../shared/models/project';

describe('AppComponent', () => {
  let component: AppComponent;
  let fixture: ComponentFixture<AppComponent>;
  const currentPackageOperation = new BehaviorSubject<{ action: 'install' | 'update' | 'remove'; packageId: string } | null>(null);
  const packageManagerMock = {
    changeCurrentProject: jest.fn(),
    changeCurrentSources: jest.fn(),
    refreshCurrentPackages: jest.fn(),
    changeCurrentPackageOperation: jest.fn((operation) => currentPackageOperation.next(operation)),
    currentPackageOperation,
  };

  beforeEach(
    waitForAsync(() => {
      TestBed.configureTestingModule({
        declarations: [AppComponent],
        imports: [CommonModule],
        providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
        schemas: [NO_ERRORS_SCHEMA],
      }).compileComponents();
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

  test('should refresh current packages when the extension reports completed package operations', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'packages-changed' },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.refreshCurrentPackages).toHaveBeenCalledTimes(1);
  });

  test('shows the current package operation and clears it after completion', () => {
    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-progress', operation: { action: 'update', packageId: 'Newtonsoft.Json' } },
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Updating Newtonsoft.Json...');
    expect(fixture.nativeElement.querySelector('[role="status"]')?.getAttribute('aria-live')).toBe('polite');

    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-complete' },
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="status"]')).toBeNull();
  });
});
