import { TestBed } from '@angular/core/testing';
import { of, skip, Subject, take, throwError, zip } from 'rxjs';
import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSource } from '../../shared/models/package-source';
import { Project, ProjectSet } from '../../shared/models/project';
import { ALL_PACKAGE_SOURCES } from '../models/constants';
import { NuGetApiService } from './nuget-api.service';
import { PackageManagerService } from './package-manager.service';
import { VscodeService } from './vscode.service';

describe('PackageManagerService', () => {
  let service: PackageManagerService;

  let nugetApiServiceMock: { search: jest.Mock; searchAll: jest.Mock; searchByPackageIds: jest.Mock; searchByPackageIdsAll: jest.Mock };

  let vscodeServiceMock: { postMessage: jest.Mock; postMessages: jest.Mock };

  beforeEach(() => {
    nugetApiServiceMock = {
      search: jest.fn(),
      searchAll: jest.fn(),
      searchByPackageIds: jest.fn(),
      searchByPackageIdsAll: jest.fn(),
    };
    vscodeServiceMock = {
      postMessage: jest.fn(),
      postMessages: jest.fn(),
    };
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: NuGetApiService, useValue: nugetApiServiceMock },
        { provide: VscodeService, useValue: vscodeServiceMock },
      ],
    });
    service = TestBed.inject(PackageManagerService);
  });

  test('should be created', () => {
    expect(service).toBeTruthy();
  });

  test('cancelOngoingRequests unsubscribes pending searches and package detail lookups', () => {
    const source = getMockPackageSource();
    const pendingSearch = new Subject<PackageRowModel[]>();
    const pendingDetails = new Subject<PackageRowModel[]>();
    nugetApiServiceMock.search.mockReturnValue(pendingSearch);
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(pendingDetails);

    service.queryForPackages('', false, source);
    service.changeCurrentSelectedPackage(getMockApiPackages()[0]);

    expect(pendingSearch.observed).toBe(true);
    expect(pendingDetails.observed).toBe(true);

    service.cancelOngoingRequests();

    expect(pendingSearch.observed).toBe(false);
    expect(pendingDetails.observed).toBe(false);
  });

  test('changeCurrentSources should emit new sources', (done) => {
    const expectedSources: PackageSource[] = [getMockPackageSource()];

    service.currentSources.pipe(skip(1)).subscribe((newSources: PackageSource[]) => {
      try {
        expect(newSources).toBe(expectedSources);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentSources(expectedSources);
  });

  test('changeCurrentCategory should emit Browse by default', (done) => {
    service.currentCategory.subscribe((category: Category) => {
      try {
        expect(category).toBe(Category.Browse);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('changeCurrentCategory should emit new category', (done) => {
    const expectedCategory: Category = Category.Installed;

    service.currentCategory.pipe(skip(1)).subscribe((category: Category) => {
      try {
        expect(category).toBe(expectedCategory);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentCategory(expectedCategory);
  });

  test('changeCurrentProject should emit new project and set installed info', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();
    const currentPackages: PackageRowModel[] = getMockApiPackages();

    const expectedProject: Project = getMockCurrentProject();
    nugetApiServiceMock.search.mockReturnValue(of(currentPackages));
    service.queryForPackages(query, prerelease, source);

    service.currentProject.pipe(skip(1)).subscribe((project: Project | null) => {
      try {
        expect(project).toBe(expectedProject);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentProject(expectedProject);
  });

  test('changeCurrentProjectSet should use the solution as the current context', (done) => {
    const firstProject = getMockCurrentProject();
    const secondProject: Project = { ...getMockCurrentProject(), name: 'Second.csproj', fsPath: '/path/Second.csproj' };
    const projectSet: ProjectSet = {
      name: 'Sample.sln',
      fsPath: '/path/Sample.sln',
      projects: [firstProject, secondProject],
    };

    service.currentProject.pipe(skip(1), take(1)).subscribe((project) => {
      try {
        expect(project?.name).toBe('Sample.sln');
        expect(project?.fsPath).toBe('/path/Sample.sln');
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentProjectSet(projectSet);
  });

  test('changeCurrentSelectedPackage should emit reset current selected', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];

    selectedPackage.versions = [];

    const observables = [service.currentSelectedPackage, service.currentSelectedPackageId];

    zip(observables)
      .pipe(skip(1), take(1))
      .subscribe((results) => {
        try {
          expect(results[0]).toBeNull();
          expect(results[1]).toBe(selectedPackage.id);
          done();
        } catch (error) {
          done(error);
        }
      });

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('changeCurrentSelectedPackage should emit the new package when versions present', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];

    selectedPackage.versions = [];

    service.currentSelectedPackage.pipe(skip(2)).subscribe((result) => {
      try {
        expect(result).toBe(selectedPackage);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('changeCurrentSelectedPackage should emit the new package after getting versions from api', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];
    const source: PackageSource = getMockPackageSource();

    const packageFromApi = { ...selectedPackage };
    packageFromApi.versions = [
      {
        '@id': 'versionid',
        authors: [],
        dependencyGroups: [],
        description: 'versiondesc',
        iconUrl: 'versionicon',
        id: 'vid',
        licenseUrl: 'versionLicenceUrl',
        projectUrl: 'versionProjectUrl',
        published: 'versionPublished',
        tags: [],
        version: '0.9.0',
        listed: true,
        vulnerabilities: undefined,
      },
    ];

    nugetApiServiceMock.search.mockReturnValue({
      subscribe: jest.fn(),
    });

    service.queryForPackages('', false, source);

    service.currentSelectedPackage.pipe(skip(2)).subscribe((result) => {
      try {
        expect(result).toBe(selectedPackage);
        expect(result?.versions).toBe(packageFromApi.versions);
        done();
      } catch (error) {
        done(error);
      }
    });

    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([packageFromApi]));

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('queryForPackages should set currents to null', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();

    nugetApiServiceMock.search.mockReturnValue({
      subscribe: jest.fn(),
    });

    const observables = [service.currentSelectedPackage, service.currentSelectedPackageId, service.currentPackages];

    zip(observables)
      .pipe(skip(1))
      .subscribe((results) => {
        try {
          expect(results[0]).toBeNull();
          expect(results[1]).toBeNull();
          expect(results[2]).toBeNull();
          done();
        } catch (error) {
          done(error);
        }
      });

    service.queryForPackages(query, prerelease, source);

    expect(nugetApiServiceMock.search).toHaveBeenCalledWith(query, prerelease, source);
  });

  test('queryForPackages should query all sources when All is selected', () => {
    const query = 'test';
    const prerelease = false;
    const sources = [getMockPackageSource(), { ...getMockPackageSource(), name: 'private', url: 'private.example' }];

    nugetApiServiceMock.searchAll.mockReturnValue(of([]));
    service.changeCurrentSources(sources);

    service.queryForPackages(query, prerelease, ALL_PACKAGE_SOURCES);

    expect(nugetApiServiceMock.searchAll).toHaveBeenCalledWith(query, prerelease, sources);
    expect(nugetApiServiceMock.search).not.toHaveBeenCalled();
  });

  test('refreshCurrentPackages should repeat the active Updates query and remove packages that are no longer outdated', () => {
    const source = getMockPackageSource();
    const sources = [source];
    const latestPackage = getMockApiPackages()[0];
    latestPackage.version = '1.0.0';
    nugetApiServiceMock.searchByPackageIdsAll.mockReturnValue(of([latestPackage]));
    service.changeCurrentSources(sources);
    service.changeCurrentProject({
      ...getMockCurrentProject(),
      packages: [{ id: 'Package1', version: '0.9.0' }],
    });
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('Package1', true, ALL_PACKAGE_SOURCES);
    service.changeCurrentProject({
      ...getMockCurrentProject(),
      packages: [{ id: 'Package1', version: '1.0.0' }],
    });
    service.refreshCurrentPackages();

    let currentPackages: PackageRowModel[] | null = null;
    service.currentPackages.subscribe((packages) => {
      currentPackages = packages;
    });

    expect(nugetApiServiceMock.searchByPackageIdsAll).toHaveBeenCalledTimes(2);
    expect(nugetApiServiceMock.searchByPackageIdsAll).toHaveBeenLastCalledWith(['Package1'], 'Package1', true, sources);
    expect(currentPackages).toEqual([]);
  });

  test('refreshCurrentPackages does nothing before a search source is selected', () => {
    service.refreshCurrentPackages();

    expect(nugetApiServiceMock.search).not.toHaveBeenCalled();
    expect(nugetApiServiceMock.searchAll).not.toHaveBeenCalled();
    expect(nugetApiServiceMock.searchByPackageIds).not.toHaveBeenCalled();
    expect(nugetApiServiceMock.searchByPackageIdsAll).not.toHaveBeenCalled();
  });

  test('queryForPackages should stop loading when Updates search fails', () => {
    const source = getMockPackageSource();
    const currentProject = getMockCurrentProject();
    let receivedPackages: PackageRowModel[] | null | undefined;

    service.changeCurrentSources([source]);
    service.changeCurrentProject(currentProject);
    service.currentPackages.subscribe((packages) => {
      receivedPackages = packages;
    });
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(throwError(() => new Error('source unavailable')));
    service.changeCurrentCategory(Category.Updates);
    service.queryForPackages('', false, source);

    expect(receivedPackages).toEqual([]);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalled();
  });

  test('queryForPackages should set current packages with installed info on browse', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();

    const currentProject: Project = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    const expectedPackagesFromApi: PackageRowModel[] = getMockApiPackages();

    service.currentPackages.pipe(skip(2)).subscribe((packages: PackageRowModel[] | null) => {
      try {
        expect(packages).not.toBeNull();
        expect(packages).toBe(expectedPackagesFromApi);

        const firstPackage = packages?.[0];
        expect(firstPackage?.installedVersion).toBe(currentProject.packages[0].version);
        expect(firstPackage?.isInstalled).toBe(true);
        expect(firstPackage?.isOutdated).toBe(true);
        const secondPackage = packages?.[1];
        expect(secondPackage?.installedVersion).toBe(currentProject.packages[1].version);
        expect(secondPackage?.isInstalled).toBe(true);
        expect(secondPackage?.isOutdated).toBe(false);
        const thirdPackage = packages?.[2];
        expect(thirdPackage?.installedVersion).toBe('');
        expect(thirdPackage?.isInstalled).toBe(false);
        expect(thirdPackage?.isOutdated).toBe(false);

        expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    nugetApiServiceMock.search.mockReturnValue(of(expectedPackagesFromApi));

    service.queryForPackages(query, prerelease, source);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each<any>([
    [Category.Installed, 2],
    [Category.Updates, 1],
  ])(
    'queryForPackages should set current packages with installed info and filter results for category: %p',
    (category: Category, expectedResultCount: number, done: jest.DoneCallback) => {
      const query = 'test';
      const prerelease = true;
      const source: PackageSource = getMockPackageSource();

      const currentProject: Project = getMockCurrentProject();

      service.changeCurrentProject(currentProject);

      service.changeCurrentCategory(category);

      const expectedPackagesFromApi: PackageRowModel[] = getMockApiPackages().slice(0, 2);

      service.currentPackages.pipe(skip(2)).subscribe((packages: PackageRowModel[] | null) => {
        try {
          expect(packages).not.toBeNull();
          expect(packages?.length).toBe(expectedResultCount);

          const firstPackage = packages?.[0];
          expect(firstPackage?.installedVersion).toBe(currentProject.packages[0].version);
          expect(firstPackage?.isInstalled).toBe(true);
          expect(firstPackage?.isOutdated).toBe(true);

          if (category === Category.Installed) {
            const secondPackage = packages?.[1];
            expect(secondPackage?.installedVersion).toBe(currentProject.packages[1].version);
            expect(secondPackage?.isInstalled).toBe(true);
            expect(secondPackage?.isOutdated).toBe(false);
          }

          expect(nugetApiServiceMock.search).toHaveBeenCalledTimes(0);
          done();
        } catch (error) {
          done(error);
        }
      });

      nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(expectedPackagesFromApi));

      service.queryForPackages(query, prerelease, source);
    }
  );

  test('queryForPackages should filter Installed packages by vulnerabilities in the installed version', () => {
    const currentProject = getMockCurrentProject();
    const packages = getMockApiPackages().slice(0, 2);
    const package1Installed = {
      '@id': 'package1-installed',
      authors: [],
      dependencyGroups: [],
      description: 'description',
      iconUrl: 'iconUrl',
      id: 'Package1',
      licenseUrl: '',
      projectUrl: '',
      published: '',
      tags: [],
      version: '0.9.0',
      listed: true,
      vulnerabilities: [{ advisoryUrl: 'https://example.com/advisory', severity: '3' }],
    };
    packages[0].versions = [package1Installed, { ...package1Installed, version: '1.0.0', vulnerabilities: undefined }];
    const package2Installed = { ...package1Installed, '@id': 'package2-installed', id: 'Package2', version: '2.0.0', vulnerabilities: undefined };
    packages[1].versions = [package2Installed, { ...package2Installed, version: '3.0.0', vulnerabilities: package1Installed.vulnerabilities }];

    service.changeCurrentProject(currentProject);
    service.changeCurrentCategory(Category.Installed);
    service.changeShowOnlyVulnerable(true);
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(packages));
    let receivedPackageIds: string[] = [];
    service.currentPackages.subscribe((currentPackages) => {
      receivedPackageIds = currentPackages?.map((packageRow) => packageRow.id) ?? [];
    });

    service.queryForPackages('', false, getMockPackageSource());

    expect(receivedPackageIds).toEqual(['Package1']);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each<any>([
    [undefined, '1.0.0'],
    ['0.8.0', '0.8.0'],
  ])('installPackage should call postMessage with correct version', (callingVersion: string, expectedVersion: string) => {
    const packageToInstall = getMockApiPackages()[0];

    const currentProject = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    vscodeServiceMock.postMessage.mockClear();

    service.installPackage(packageToInstall, callingVersion);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: expectedVersion,
      packageSourceUrl: packageToInstall.sourceUrl,
      operation: 'install',
    });
  });

  test('installPackage should call postMessage with correct version', () => {
    const packageToUninstall = getMockApiPackages()[0];

    const currentProject = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    vscodeServiceMock.postMessage.mockClear();

    service.uninstallPackage(packageToUninstall);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({
      command: 'remove-package',
      projectName: currentProject.fsPath,
      packageId: packageToUninstall.id,
    });
  });

  test('installPackage marks updates separately from installs', () => {
    const packageToUpdate = getMockApiPackages()[0];
    service.changeCurrentProject(getMockCurrentProject());

    service.installPackage(packageToUpdate, undefined, 'update');

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'add-package',
      packageId: packageToUpdate.id,
      operation: 'update',
    }));
  });

  test('installPackages should target only projects where each package is installed', () => {
    const firstProjectPath = '/solution/First.csproj';
    const secondProjectPath = '/solution/Second.csproj';
    const thirdProjectPath = '/solution/Third.csproj';
    const firstProject: Project = {
      name: 'First.csproj',
      fsPath: firstProjectPath,
      packages: [{ id: 'Package1', version: '0.9.0' }],
    };
    const secondProject: Project = {
      name: 'Second.csproj',
      fsPath: secondProjectPath,
      packages: [{ id: 'Package2', version: '1.9.0' }],
    };
    const thirdProject: Project = {
      name: 'Third.csproj',
      fsPath: thirdProjectPath,
      packages: [{ id: 'Package1', version: '0.8.0' }],
    };
    service.changeCurrentProjectSet({
      name: 'Sample.sln',
      fsPath: '/solution/Sample.sln',
      projects: [firstProject, secondProject, thirdProject],
    });
    service.setSelectedProjectPaths([firstProjectPath, secondProjectPath, thirdProjectPath]);

    const package1 = { ...getMockApiPackages()[0], isOutdated: true, installedProjectPaths: [firstProjectPath, thirdProjectPath] };
    const package2 = { ...getMockApiPackages()[1], isOutdated: true, installedProjectPaths: [secondProjectPath] };
    service.installPackages([package1, package2]);

    expect(vscodeServiceMock.postMessages).toHaveBeenCalledWith([
      {
        command: 'add-package',
        projectName: '/solution/Sample.sln',
        packageId: 'Package1',
        packageVersion: package1.version,
        packageSourceUrl: package1.sourceUrl,
        projectPaths: [firstProjectPath, thirdProjectPath],
        operation: 'update',
      },
      {
        command: 'add-package',
        projectName: '/solution/Sample.sln',
        packageId: 'Package2',
        packageVersion: package2.version,
        packageSourceUrl: package2.sourceUrl,
        projectPaths: [secondProjectPath],
        operation: 'update',
      },
    ]);
  });

  test('installPackages should not send messages for an empty selection', () => {
    service.installPackages([]);

    expect(vscodeServiceMock.postMessages).not.toHaveBeenCalled();
  });

  function getMockApiPackages(): PackageRowModel[] {
    return [
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package1',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '1.0.0',
        versions: undefined,
      },
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package2',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '2.0.0',
        versions: undefined,
      },
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package3',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '3.0.0',
        versions: undefined,
      },
    ];
  }

  function getMockCurrentProject(): Project {
    return {
      name: 'TestProject',
      fsPath: '/path/on/disk',
      packages: [
        {
          id: 'Package1',
          version: '0.9.0',
        },
        {
          id: 'Package2',
          version: '2.0.0',
        },
      ],
    };
  }

  function getMockPackageSource(): PackageSource {
    return {
      name: 'nuget.org',
      url: 'www.nuget.org',
      authorizationHeader: undefined,
    };
  }
});
