import { ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject } from 'rxjs';

import { Category } from '../../models/category';
import { ALL_PACKAGE_SOURCES, NUGET_ORG } from '../../models/constants';
import { PackageSource } from '../../../shared/models/package-source';
import { PackageManagerService } from '../../services/package-manager.service';
import { VscodeService } from '../../services/vscode.service';
import { ToolBarComponent } from './tool-bar.component';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';

describe('ToolBarComponent', () => {
  let fixture: ComponentFixture<ToolBarComponent>;
  let component: ToolBarComponent;
  const sources = new BehaviorSubject<PackageSource[]>([]);
  const category = new BehaviorSubject<Category>(Category.Browse);
  const packageSearchRequested = new Subject<string>();
  const packageManagerMock = {
    currentSources: sources.asObservable(),
    currentCategory: category.asObservable(),
    packageSearchRequested: packageSearchRequested.asObservable(),
    preferredSourceUrl: undefined as string | undefined,
    queryForPackages: jest.fn(),
    changeShowOnlyVulnerable: jest.fn(),
    cancelOngoingRequests: jest.fn(),
  };
  const vscodeServiceMock = { postMessage: jest.fn() };

  beforeEach(async () => {
    sources.next([]);
    category.next(Category.Browse);
    packageManagerMock.preferredSourceUrl = undefined;
    jest.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [ToolBarComponent, ReactiveFormsModule],
      providers: [
        { provide: PackageManagerService, useValue: packageManagerMock },
        { provide: VscodeService, useValue: vscodeServiceMock },
      ],
    }).compileComponents();

    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    fixture = TestBed.createComponent(ToolBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the reactive search controls', () => {
    expect(fixture.nativeElement.querySelector('input[type="search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('select')).not.toBeNull();
  });

  it('fills the search field when an alternate package search is requested', () => {
    packageSearchRequested.next('packageid:AutoMapper');

    expect(component.searchForm.get('query')?.value).toBe('packageid:AutoMapper');
  });

  it('keeps the form and search state when package sources change', () => {
    const form = component.searchForm;
    form.get('query')?.setValue('Newtonsoft');
    const originalSource: PackageSource = { name: 'Private feed', url: 'https://packages.example.test/v3/index.json', authorizationHeader: undefined };
    sources.next([originalSource]);
    form.get('source')?.setValue(originalSource);

    const updatedSource: PackageSource = { ...originalSource, name: 'Updated private feed' };
    sources.next([updatedSource]);

    expect(component.searchForm).toBe(form);
    expect(form.get('query')?.value).toBe('Newtonsoft');
    expect(form.get('source')?.value).toBe(updatedSource);
    expect(component.packageSources).toEqual([
      ALL_PACKAGE_SOURCES,
      updatedSource,
    ]);
  });

  it('restores the saved source by URL when package sources load', () => {
    const savedSource: PackageSource = {
      name: 'Renamed feed',
      url: 'https://packages.example.test/v3/index.json',
      authorizationHeader: undefined,
    };
    packageManagerMock.preferredSourceUrl = savedSource.url;

    sources.next([{ ...savedSource, name: 'Current feed name' }]);

    expect(component.searchForm.get('source')?.value).toEqual({ ...savedSource, name: 'Current feed name' });
    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, { ...savedSource, name: 'Current feed name' });
    expect(vscodeServiceMock.postMessage).not.toHaveBeenCalledWith({ command: 'select-source', sourceUrl: '' });
  });

  it('selects NuGet.org V3 by default when no source has been saved', () => {
    const customNuget: PackageSource = {
      name: 'NuGet private feed',
      url: 'https://packages.example.test/v3/index.json',
      authorizationHeader: undefined,
    };

    sources.next([customNuget, NUGET_ORG]);

    expect(component.searchForm.get('source')?.value).toEqual(NUGET_ORG);
  });

  it('selects the first source whose name contains nuget when NuGet.org V3 is unavailable', () => {
    const firstMatch: PackageSource = {
      name: 'Internal NUGET feed',
      url: 'https://packages.example.test/first/index.json',
      authorizationHeader: undefined,
    };
    const secondMatch: PackageSource = {
      name: 'NuGet mirror',
      url: 'https://packages.example.test/second/index.json',
      authorizationHeader: undefined,
    };

    sources.next([firstMatch, { name: 'Private feed', url: 'https://private.example.test/index.json', authorizationHeader: undefined }, secondMatch]);

    expect(component.searchForm.get('source')?.value).toEqual(firstMatch);
  });

  it('keeps All as the default when no source name contains nuget', () => {
    sources.next([{ name: 'Private feed', url: 'https://private.example.test/index.json', authorizationHeader: undefined }]);

    expect(component.searchForm.get('source')?.value).toBe(ALL_PACKAGE_SOURCES);
  });

  it('restores All when the saved source is no longer configured', () => {
    packageManagerMock.preferredSourceUrl = 'https://removed.example.test/v3/index.json';

    sources.next([{ name: 'Current feed', url: 'https://current.example.test/v3/index.json', authorizationHeader: undefined }]);

    expect(component.searchForm.get('source')?.value).toBe(ALL_PACKAGE_SOURCES);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({ command: 'select-source', sourceUrl: '' });
  });

  it('saves the selected source URL when the user changes the selection', () => {
    const source: PackageSource = {
      name: 'Private feed',
      url: 'https://packages.example.test/v3/index.json',
      authorizationHeader: undefined,
    };
    sources.next([source]);
    vscodeServiceMock.postMessage.mockClear();

    component.searchForm.get('source')?.setValue(source);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith({ command: 'select-source', sourceUrl: source.url });
    expect(packageManagerMock.cancelOngoingRequests).toHaveBeenCalledTimes(1);
  });

  it('restores the All selection saved as an empty URL', () => {
    packageManagerMock.preferredSourceUrl = '';
    const source: PackageSource = {
      name: 'Private feed',
      url: 'https://packages.example.test/v3/index.json',
      authorizationHeader: undefined,
    };

    sources.next([source]);

    expect(component.searchForm.get('source')?.value).toBe(ALL_PACKAGE_SOURCES);
  });

  it('keeps a user-selected All value when the source list changes', () => {
    component.searchForm.get('source')?.setValue(ALL_PACKAGE_SOURCES);

    sources.next([{ name: 'NuGet private feed', url: 'https://packages.example.test/index.json', authorizationHeader: undefined }]);

    expect(component.searchForm.get('source')?.value).toBe(ALL_PACKAGE_SOURCES);
  });
});
