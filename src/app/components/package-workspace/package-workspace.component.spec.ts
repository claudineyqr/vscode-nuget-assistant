import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { PackageManagerService } from '../../services/package-manager.service';
import { PackageWorkspaceComponent } from './package-workspace.component';

describe('PackageWorkspaceComponent', () => {
  let fixture: ComponentFixture<PackageWorkspaceComponent>;
  let component: PackageWorkspaceComponent;
  const currentPackageOperation = new BehaviorSubject<{
    action: 'install' | 'update' | 'remove';
    packageId: string;
  } | null>(null);
  const packageManagerMock = {
    currentPackageOperation,
    cancelCurrentPackageOperation: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    currentPackageOperation.next(null);

    await TestBed.configureTestingModule({
      imports: [PackageWorkspaceComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
      schemas: [NO_ERRORS_SCHEMA],
    })
      .overrideComponent(PackageWorkspaceComponent, {
        set: {
          template: '@if (packageManager.currentPackageOperation | async; as operation) {<output class="package-operation flex items-center border-l-4" role="status" aria-live="polite" aria-atomic="true">{{ getOperationLabel(operation.action) }} {{ operation.packageId }}... <button type="button" aria-label="Cancel operation" (click)="cancelPackageOperation()">Cancel</button></output>}',
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(PackageWorkspaceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  test('forwards cancellation requests to the package manager', () => {
    component.cancelPackageOperation();

    expect(packageManagerMock.cancelCurrentPackageOperation).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['install', 'Installing'],
    ['update', 'Updating'],
    ['remove', 'Uninstalling'],
  ] as const)('provides the %s operation label', (action, label) => {
    expect(component.getOperationLabel(action)).toBe(label);
  });

  test.each([
    ['install', 'Installing'],
    ['remove', 'Uninstalling'],
    ['update', 'Updating'],
  ] as const)('shows the %s operation with an accessible highlight and clears it after completion', (action, label) => {
    currentPackageOperation.next({ action, packageId: 'Newtonsoft.Json' });
    fixture.detectChanges();

    const operationIndicator = fixture.nativeElement.querySelector('output.package-operation[role="status"][aria-live="polite"][aria-atomic="true"]');
    expect(operationIndicator).not.toBeNull();
    expect(operationIndicator.textContent).toContain(`${label} Newtonsoft.Json...`);
    expect(operationIndicator.classList).toContain('border-l-4');

    const cancelButton = operationIndicator.querySelector('button[aria-label="Cancel operation"]') as HTMLButtonElement;
    expect(cancelButton).not.toBeNull();
    cancelButton.click();
    expect(packageManagerMock.cancelCurrentPackageOperation).toHaveBeenCalledTimes(1);

    currentPackageOperation.next(null);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('output.package-operation')).toBeNull();
  });
});
