import { TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { BehaviorSubject, of } from 'rxjs';
import { PackageRowModel } from '../../models/package-row-model';
import { CatalogEntry } from '../../models/package-meta';
import { Category } from '../../models/category';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageDetailsComponent } from './package-details.component';

describe('PackageDetailsComponent', () => {
  it('exposes the selected catalog version to the template', () => {
    const component = new PackageDetailsComponent({} as PackageManagerService, 'en-US');
    const version = { version: '1.2.3' };

    component.selectedVersion.setValue(version);

    expect(component.selectedVersionObject).toBe(version);
  });

  it('shows the deprecation notice without an icon beside the install button', async () => {
    const deprecatedVersion = createVersion('1.0.0', { reasons: ['Legacy'], message: 'Use the newer package.' });
    deprecatedVersion.vulnerabilities = [{ advisoryUrl: 'https://example.test/advisory', severity: '3' }];
    const regularVersion = createVersion('2.0.0');
    regularVersion.vulnerabilities = [];
    const selectedPackage: PackageRowModel = {
      id: 'Example.Package',
      version: '2.0.0',
      description: 'Package description',
      authors: 'Example',
      iconUrl: '',
      verified: false,
      installedVersion: '',
      isInstalled: false,
      isOutdated: false,
      sourceUrl: 'https://packages.example.test/v3/index.json',
      versions: [deprecatedVersion, regularVersion],
    };
    const packageManagerMock = {
      currentSelectedPackage: new BehaviorSubject<PackageRowModel | null>(selectedPackage),
      currentSelectedPackageId: new BehaviorSubject<string | null>(selectedPackage.id),
      currentProjects: of([]),
      selectedProjectPaths: of([]),
      currentCategory: of(Category.Browse),
      prepareProjectSelection: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [PackageDetailsComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();
    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    const fixture = TestBed.createComponent(PackageDetailsComponent);

    fixture.detectChanges();

    const versionOptions = Array.from(fixture.nativeElement.querySelectorAll('#package-version option') as NodeListOf<HTMLOptionElement>);
    expect(versionOptions.map((option) => option.textContent?.trim())).toEqual(['1.0.0 (Vulnerable)', '2.0.0']);
    expect(fixture.nativeElement.querySelector('.version-container [title="Deprecated package"]')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Use the newer package.');
    expect(fixture.nativeElement.querySelector('a[href$="/packages/Example.Package/1.0.0/ReportAbuse"]')).not.toBeNull();

    fixture.componentInstance.selectedVersion.setValue(regularVersion);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.version-container [title="Deprecated package"]')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Use the newer package.');
    expect(fixture.nativeElement.querySelector('a[href$="/packages/Example.Package/2.0.0/ReportAbuse"]')).not.toBeNull();
  });

  it('selects the installed version by default in the Installed category', async () => {
    const installedVersion = createVersion('1.0.0', { reasons: ['Legacy'], message: 'Installed version is deprecated.' });
    installedVersion.vulnerabilities = [{ advisoryUrl: 'https://example.test/advisory', severity: '3' }];
    const latestVersion = createVersion('2.0.0');
    const selectedPackage: PackageRowModel = {
      id: 'Example.Package',
      version: '2.0.0',
      description: 'Package description',
      authors: 'Example',
      iconUrl: '',
      verified: false,
      installedVersion: '1.0.0',
      isInstalled: true,
      isOutdated: true,
      sourceUrl: 'https://packages.example.test/v3/index.json',
      versions: [latestVersion, installedVersion],
    };
    const packageManagerMock = {
      currentSelectedPackage: new BehaviorSubject<PackageRowModel | null>(selectedPackage),
      currentSelectedPackageId: new BehaviorSubject<string | null>(selectedPackage.id),
      currentProjects: of([]),
      selectedProjectPaths: of([]),
      currentCategory: of(Category.Installed),
      prepareProjectSelection: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [PackageDetailsComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();
    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    const fixture = TestBed.createComponent(PackageDetailsComponent);

    fixture.detectChanges();

    expect(fixture.componentInstance.selectedVersionObject?.version).toBe('1.0.0');
    expect(fixture.nativeElement.textContent).toContain('Installed version is deprecated.');
    expect(fixture.nativeElement.querySelector('app-package-details-vulnerabilities')).not.toBeNull();
  });
});

function createVersion(version: string, deprecation?: CatalogEntry['deprecation']): CatalogEntry {
  return {
    '@id': '',
    id: 'Example.Package',
    version,
    description: 'Package description',
    authors: 'Example',
    iconUrl: '',
    licenseUrl: '',
    projectUrl: '',
    tags: '',
    dependencyGroups: undefined,
    published: '',
    vulnerabilities: undefined,
    deprecation,
  };
}
