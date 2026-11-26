import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UntypedFormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';

import { NuGetConfigSourceDialogComponent } from './nuget-config-source-dialog.component';

describe('NuGetConfigSourceDialogComponent', () => {
  let fixture: ComponentFixture<NuGetConfigSourceDialogComponent>;
  let component: NuGetConfigSourceDialogComponent;
  let form: UntypedFormGroup;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NuGetConfigSourceDialogComponent],
    }).compileComponents();

    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    form = TestBed.inject(UntypedFormBuilder).group({
      name: ['nuget.org', Validators.required],
      url: ['https://api.nuget.org/v3/index.json', Validators.required],
      enabled: [true],
      username: [''],
      password: [''],
      removeCredentials: [false],
    });

    fixture = TestBed.createComponent(NuGetConfigSourceDialogComponent);
    component = fixture.componentInstance;
    component.form = form;
    fixture.detectChanges();
  });

  it('renders a modal dialog with the edit title by default', () => {
    expect(fixture.nativeElement.querySelector('[role="dialog"][aria-modal="true"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Edit package source');
  });

  it('shows the add title and add action in add mode', () => {
    component.isAdd = true;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Add package source');
    expect(fixture.nativeElement.querySelector('button[type="submit"]').textContent).toContain('Add');
  });

  it('shows validation errors for invalid values', () => {
    form.get('name')?.setValue('');
    form.get('url')?.setValue('https://');
    form.get('name')?.markAsTouched();
    form.get('url')?.markAsTouched();
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Enter a name for the package source.');
  });

  it('emits save on submit and cancel only through buttons', () => {
    const save = jest.fn();
    const cancel = jest.fn();
    component.saveSource.subscribe(save);
    component.cancelRequest.subscribe(cancel);

    fixture.nativeElement.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(save).toHaveBeenCalledTimes(1);

    fixture.nativeElement.querySelector('.fixed').click();
    expect(cancel).not.toHaveBeenCalled();

    fixture.nativeElement.querySelector('header button').click();
    fixture.nativeElement.querySelector('footer button[type="button"]').click();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});

