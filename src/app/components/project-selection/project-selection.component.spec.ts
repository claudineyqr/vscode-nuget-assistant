import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { Project } from '../../../shared/models/project';
import { Category } from '../../models/category';
import { PackageRowModel } from '../../models/package-row-model';
import { PackageManagerService } from '../../services/package-manager.service';
import { ProjectSelectionComponent } from './project-selection.component';

describe('ProjectSelectionComponent', () => {
  const currentProjects = new BehaviorSubject<Project[]>([]);
  const selectedProjectPaths = new BehaviorSubject<string[]>([]);
  const currentCategory = new BehaviorSubject<Category>(Category.Browse);
  const packageManager = {
    currentProjects,
    selectedProjectPaths,
    currentCategory,
    setSelectedProjectPaths: jest.fn(),
  };

  const projects: Project[] = [
    { name: 'App.csproj', fsPath: '/repo/App.csproj', packages: [{ id: 'Contoso.Widget', version: '1.0.0' }] },
    { name: 'Tests.csproj', fsPath: '/repo/Tests.csproj', packages: [] },
  ];

  beforeEach(async () => {
    currentProjects.next(projects);
    selectedProjectPaths.next([projects[0].fsPath]);
    currentCategory.next(Category.Browse);
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [ProjectSelectionComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManager }],
    }).compileComponents();
  });

  it('shows selected projects and installed and proposed versions for updates', () => {
    const fixture = TestBed.createComponent(ProjectSelectionComponent);
    const component = fixture.componentInstance;
    component.packageToChange = { id: 'Contoso.Widget', version: '2.0.0' } as PackageRowModel;
    fixture.detectChanges();

    expect(component.isSelected(projects[0].fsPath)).toBe(true);
    expect(component.isSelected(projects[1].fsPath)).toBe(false);
    expect(component.areAllSelected).toBe(false);
    expect(component.getInstalledVersion(projects[0])).toBe('1.0.0');
    expect(component.getInstalledVersion(projects[1])).toBe('');
    expect(component.getPackageVersion(projects[0])).toBe('2.0.0');
    expect(fixture.nativeElement.querySelector('.project-selection')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('2.0.0');

    currentCategory.next(Category.Updates);
    fixture.detectChanges();

    expect(component.showVersion).toBe(true);
    expect(component.getPackageVersion(projects[0])).toBe('2.0.0');
    expect(component.getPackageVersion(projects[1])).toBe('');
    expect(fixture.nativeElement.textContent).toContain('2.0.0');
  });

  it('selects all projects, clears the selection, and updates individual paths', () => {
    const fixture = TestBed.createComponent(ProjectSelectionComponent);
    const component = fixture.componentInstance;
    fixture.detectChanges();

    component.toggleAll({ target: { checked: true } } as unknown as Event);
    expect(packageManager.setSelectedProjectPaths).toHaveBeenLastCalledWith(projects.map(({ fsPath }) => fsPath));
    selectedProjectPaths.next(projects.map(({ fsPath }) => fsPath));
    expect(component.areAllSelected).toBe(true);

    component.toggle(projects[0].fsPath, { target: { checked: false } } as unknown as Event);
    expect(packageManager.setSelectedProjectPaths).toHaveBeenLastCalledWith([projects[1].fsPath]);
    selectedProjectPaths.next([projects[1].fsPath]);
    component.toggle(projects[0].fsPath, { target: { checked: true } } as unknown as Event);
    expect(packageManager.setSelectedProjectPaths).toHaveBeenLastCalledWith([projects[1].fsPath, projects[0].fsPath]);

    component.toggleAll({ target: { checked: false } } as unknown as Event);
    expect(packageManager.setSelectedProjectPaths).toHaveBeenLastCalledWith([]);
  });

  it('does not report all selected when the solution has no projects', () => {
    currentProjects.next([]);
    selectedProjectPaths.next([]);
    const fixture = TestBed.createComponent(ProjectSelectionComponent);
    fixture.detectChanges();

    expect(fixture.componentInstance.areAllSelected).toBe(false);
    expect(fixture.nativeElement.querySelector('.project-selection')).toBeNull();
  });
});
