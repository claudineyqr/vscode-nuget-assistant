import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Category } from '../../models/category';
import { PackageManagerService } from '../../services/package-manager.service';
import { NavBarComponent } from './nav-bar.component';

describe('NavBarComponent', () => {
  const currentCategory = new BehaviorSubject<Category>(Category.Browse);
  const currentProject = new BehaviorSubject<{ name: string; fsPath: string } | null>(null);
  const packageManager = {
    currentCategory,
    currentProject,
    changeCurrentCategory: jest.fn(),
  };

  beforeEach(async () => {
    currentCategory.next(Category.Browse);
    currentProject.next(null);
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [NavBarComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManager }],
    }).compileComponents();
  });

  it('tracks project and category changes and forwards category selection', () => {
    const fixture = TestBed.createComponent(NavBarComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    currentProject.next({ name: 'Demo', fsPath: 'C:/src/Demo.csproj' });
    currentCategory.next(Category.Updates);
    expect(component.currentProjectName).toBe('Demo');
    expect(component.currentProjectFsPath).toBe('C:/src/Demo.csproj');
    expect(component.currentCategory).toBe(Category.Updates);

    component.categoryChange(Category.Installed);
    expect(packageManager.changeCurrentCategory).toHaveBeenCalledWith(Category.Installed);
  });
});
