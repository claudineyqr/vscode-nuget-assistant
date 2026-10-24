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
    queryForPackages: jest.fn(),
    changeShowOnlyVulnerable: jest.fn(),
  };
  const vscodeServiceMock = { postMessage: jest.fn() };

  beforeEach(async () => {
    sources.next([]);
    category.next(Category.Browse);
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
});
