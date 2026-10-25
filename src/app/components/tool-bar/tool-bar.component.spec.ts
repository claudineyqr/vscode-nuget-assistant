import { ReactiveFormsModule } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';

import { Category } from '../../models/category';
import { ALL_PACKAGE_SOURCES } from '../../models/constants';
import { PackageSource } from '../../../shared/models/package-source';
import { PackageManagerService } from '../../services/package-manager.service';
import { VscodeService } from '../../services/vscode.service';
import { ToolBarComponent } from './tool-bar.component';

describe('ToolBarComponent', () => {
  let fixture: ComponentFixture<ToolBarComponent>;
  let component: ToolBarComponent;
  const sources = new BehaviorSubject<PackageSource[]>([]);
  const category = new BehaviorSubject<Category>(Category.Browse);
  const packageManagerMock = {
    currentSources: sources.asObservable(),
    currentCategory: category.asObservable(),
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
      declarations: [ToolBarComponent],
      imports: [ReactiveFormsModule],
      providers: [
        { provide: PackageManagerService, useValue: packageManagerMock },
        { provide: VscodeService, useValue: vscodeServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ToolBarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders the reactive search controls', () => {
    expect(fixture.nativeElement.querySelector('input[type="search"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('select')).not.toBeNull();
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
});
