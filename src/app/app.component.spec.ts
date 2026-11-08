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
        imports: [AppComponent, CommonModule],
        providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
        schemas: [NO_ERRORS_SCHEMA],
      })
        .overrideComponent(AppComponent, {
          set: {
            imports: [CommonModule],
            template: '<output *ngIf="packageManager.currentPackageOperation | async as operation" class="package-operation flex items-center border-l-4" role="status" aria-live="polite" aria-atomic="true">{{ operation.action === "remove" ? "Uninstalling" : operation.action === "update" ? "Updating" : "Installing" }} {{ operation.packageId }}...</output>',
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

  test('should refresh current packages when the extension reports completed package operations', () => {
    const event = new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'packages-changed' },
    });

    window.dispatchEvent(event);

    expect(packageManagerMock.refreshCurrentPackages).toHaveBeenCalledWith(true);
  });

  test.each([
    ['install', 'Installing'],
    ['remove', 'Uninstalling'],
    ['update', 'Updating'],
  ] as const)('shows the %s operation with an accessible highlight and clears it after completion', (action, label) => {
    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-progress', operation: { action, packageId: 'Newtonsoft.Json' } },
    }));
    fixture.detectChanges();

    const operationIndicator = fixture.nativeElement.querySelector('output.package-operation[role="status"][aria-live="polite"][aria-atomic="true"]');
    expect(operationIndicator).not.toBeNull();
    expect(operationIndicator.textContent).toContain(`${label} Newtonsoft.Json...`);
    expect(operationIndicator.classList).toContain('border-l-4');

    window.dispatchEvent(new MessageEvent<ExtensionMessage>('message', {
      data: { type: 'package-operation-complete' },
    }));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('output.package-operation')).toBeNull();
  });
});
