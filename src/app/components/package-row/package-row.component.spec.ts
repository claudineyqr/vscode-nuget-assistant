import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { PackageRowComponent } from './package-row.component';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageRowModel } from '../../models/package-row-model';

describe('PackageRowComponent', () => {
  const packageManager = {
    changeCurrentSelectedPackage: jest.fn(),
    installPackage: jest.fn(),
    uninstallPackage: jest.fn(),
  };
  let component: PackageRowComponent;

  beforeEach(() => {
    packageManager.changeCurrentSelectedPackage.mockClear();
    packageManager.installPackage.mockClear();
    packageManager.uninstallPackage.mockClear();
    component = new PackageRowComponent(packageManager as unknown as PackageManagerService);
  });

  it('selects the package when the native row button is activated', () => {
    const packageRow = { id: 'Example.Package' } as PackageRowModel;
    component.package = packageRow;

    component.click();

    expect(packageManager.changeCurrentSelectedPackage).toHaveBeenCalledWith(packageRow);
  });

  it('emits checkbox changes and stops action clicks from selecting the row', () => {
    const packageRow = { id: 'Example.Package' } as PackageRowModel;
    component.package = packageRow;
    const emitSelection = jest.spyOn(component.changeSelect, 'emit');
    const clickEvent = { stopPropagation: jest.fn() } as unknown as MouseEvent;

    component.select({ target: { checked: true } } as unknown as Event);
    component.install(clickEvent);
    component.uninstall(clickEvent);
    component.update(clickEvent);

    expect(emitSelection).toHaveBeenCalledWith(true);
    expect(clickEvent.stopPropagation).toHaveBeenCalledTimes(3);
    expect(packageManager.installPackage).toHaveBeenNthCalledWith(1, packageRow, undefined, 'install');
    expect(packageManager.uninstallPackage).toHaveBeenCalledWith(packageRow);
    expect(packageManager.installPackage).toHaveBeenNthCalledWith(2, packageRow, undefined, 'update');
  });

});

describe('PackageRowComponent warning indicator', () => {
  let fixture: ComponentFixture<PackageRowComponent>;
  const warningPackageManager = {
    changeCurrentSelectedPackage: jest.fn(),
    installPackage: jest.fn(),
    uninstallPackage: jest.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PackageRowComponent],
      providers: [{ provide: PackageManagerService, useValue: warningPackageManager }],
    }).compileComponents();
    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    fixture = TestBed.createComponent(PackageRowComponent);
  });

  it.each([
    [{ deprecation: { reasons: ['Legacy'] } }, 'Deprecated package'],
    [{ vulnerabilities: [{ advisoryUrl: 'https://example.test/advisory', severity: '2' }] }, 'This package has vulnerabilities'],
    [
      {
        deprecation: { reasons: ['Legacy'] },
        vulnerabilities: [{ advisoryUrl: 'https://example.test/advisory', severity: '2' }],
      },
      'Deprecated package; This package has vulnerabilities',
    ],
  ])('shows a warning icon with the title for package metadata %p', (metadata, expectedTitle) => {
    fixture.componentInstance.package = createPackageRow(metadata);
    fixture.detectChanges();

    const warningIcon = fixture.nativeElement.querySelector('fa-icon[title]') as HTMLElement | null;
    expect(warningIcon).not.toBeNull();
    expect(warningIcon?.getAttribute('title')).toBe(expectedTitle);
    expect(fixture.nativeElement.textContent).toContain('2.0.0');
  });

  it('does not show the warning icon when metadata has neither deprecation nor vulnerabilities', () => {
    fixture.componentInstance.package = createPackageRow({ vulnerabilities: [] });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('fa-icon[title]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('2.0.0');
  });

  it('hides row operation buttons when project selection is handled in solution details', () => {
    fixture.componentInstance.package = createPackageRow({ isInstalled: true, isOutdated: true });
    fixture.componentInstance.hideOperationButtons = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.actions')).toBeNull();
  });

  it('shows an additional warning beside the installed version using that version metadata', () => {
    fixture.componentInstance.package = createPackageRow({
      version: '2.0.0',
      installedVersion: '1.0.0',
      isInstalled: true,
      isOutdated: true,
      installedVersionMetadata: {
        ...createCatalogEntry('1.0.0'),
        deprecation: { reasons: ['Legacy'] },
        vulnerabilities: [{ advisoryUrl: 'https://example.test/advisory', severity: '3' }],
      },
    });
    fixture.detectChanges();

    const warningIcons = fixture.nativeElement.querySelectorAll('fa-icon[title]') as NodeListOf<HTMLElement>;
    expect(warningIcons).toHaveLength(1);
    expect(warningIcons[0].getAttribute('title')).toBe('Deprecated package; This package has vulnerabilities');
    expect(fixture.nativeElement.textContent).toContain('1.0.0');
    expect(fixture.nativeElement.textContent).toContain('2.0.0');
  });

  it('uses installed-version metadata for the displayed version when it is also the latest', () => {
    fixture.componentInstance.package = createPackageRow({
      version: '1.0.0',
      installedVersion: '1.0.0',
      isInstalled: true,
      isOutdated: false,
      installedVersionMetadata: {
        ...createCatalogEntry('1.0.0'),
        vulnerabilities: [{ advisoryUrl: 'https://example.test/advisory', severity: '3' }],
      },
    });
    fixture.detectChanges();

    const warningIcons = fixture.nativeElement.querySelectorAll('fa-icon[title]') as NodeListOf<HTMLElement>;
    expect(warningIcons).toHaveLength(1);
    expect(warningIcons[0].getAttribute('title')).toBe('This package has vulnerabilities');
  });
});

function createCatalogEntry(version: string): NonNullable<PackageRowModel['installedVersionMetadata']> {
  return {
    '@id': '',
    id: 'Example.Package',
    version,
    description: '',
    authors: '',
    iconUrl: '',
    licenseUrl: '',
    projectUrl: '',
    tags: '',
    dependencyGroups: undefined,
    published: '',
    vulnerabilities: undefined,
  };
}

function createPackageRow(metadata: Partial<PackageRowModel>): PackageRowModel {
  return {
    id: 'Example.Package',
    version: '2.0.0',
    description: 'Example package',
    authors: 'Example',
    iconUrl: '',
    verified: false,
    installedVersion: '',
    isInstalled: false,
    isOutdated: false,
    sourceUrl: 'https://packages.example.test/v3/index.json',
    versions: undefined,
    ...metadata,
  };
}
