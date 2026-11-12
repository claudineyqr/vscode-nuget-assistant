import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Category } from '../../models/category';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageListComponent } from './package-list.component';

describe('PackageListComponent selection', () => {
  const packages = new BehaviorSubject<PackageRowModel[] | null>(null);
  const selectedPackageId = new BehaviorSubject<string | null>(null);
  const category = new BehaviorSubject<Category>(Category.Browse);
  const solutionMode = new BehaviorSubject(false);
  const packageManager = {
    currentPackages: packages,
    currentSelectedPackageId: selectedPackageId,
    currentCategory: category,
    isSolutionMode: solutionMode,
    installPackages: jest.fn(),
  };

  beforeEach(async () => {
    packages.next(null);
    selectedPackageId.next(null);
    category.next(Category.Browse);
    solutionMode.next(false);
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [PackageListComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManager }],
    }).compileComponents();
  });

  it('selects and deselects rows and reports when every package is selected', () => {
    const fixture = TestBed.createComponent(PackageListComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const first = { id: 'one' } as PackageRowModel;
    const second = { id: 'two' } as PackageRowModel;
    component.packages = [first, second];

    component.selectRow(first);
    expect(component.areAllSelected).toBe(false);
    component.selectRow(second);
    expect(component.areAllSelected).toBe(true);
    component.deselectRow(first);
    expect(component.areAllSelected).toBe(false);
  });

  it('selects all packages, clears selection, and installs the selected set', () => {
    const fixture = TestBed.createComponent(PackageListComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    const first = { id: 'one' } as PackageRowModel;
    const second = { id: 'two' } as PackageRowModel;
    component.packages = [first, second];

    component.selectAll({ target: { checked: true } } as unknown as Event);
    expect(component.areAllSelected).toBe(true);
    component.updateSelected();
    expect(packageManager.installPackages).toHaveBeenCalledWith([first, second]);
    expect(component.selectionService.isEmpty).toBe(true);

    component.selectAll({ target: { checked: false } } as unknown as Event);
    expect(component.selectionService.isEmpty).toBe(true);
  });

  it('shows bulk selection controls only for a non-empty updates list', () => {
    const fixture = TestBed.createComponent(PackageListComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    category.next(Category.Updates);
    expect(component.showSelectCheckboxes).toBe(false);
    packages.next([{ id: 'one' } as PackageRowModel]);
    expect(component.showSelectCheckboxes).toBe(true);
    category.next(Category.Browse);
    expect(component.showSelectCheckboxes).toBe(false);
  });

  it('passes solution mode to package rows so their operation buttons are hidden', () => {
    const fixture = TestBed.createComponent(PackageListComponent);
    fixture.detectChanges();

    solutionMode.next(true);

    expect(fixture.componentInstance.isSolutionMode).toBe(true);
  });
});
