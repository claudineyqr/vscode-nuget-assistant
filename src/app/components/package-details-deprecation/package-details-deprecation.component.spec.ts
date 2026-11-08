import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { PackageManagerService } from '../../services/package-manager.service';
import { PackageDetailsDeprecationComponent } from './package-details-deprecation.component';

describe('PackageDetailsDeprecationComponent', () => {
  let fixture: ComponentFixture<PackageDetailsDeprecationComponent>;
  const packageManagerMock = { requestPackageSearch: jest.fn() };

  beforeEach(async () => {
    packageManagerMock.requestPackageSearch.mockClear();
    await TestBed.configureTestingModule({
      imports: [PackageDetailsDeprecationComponent],
      providers: [{ provide: PackageManagerService, useValue: packageManagerMock }],
    }).compileComponents();
    TestBed.inject(FaIconLibrary).addIconPacks(fas);
    fixture = TestBed.createComponent(PackageDetailsDeprecationComponent);
  });

  it('shows the deprecation reason, message, and alternate package', () => {
    fixture.componentInstance.packageId = 'AutoMapper.Extensions.Microsoft.DependencyInjection';
    fixture.componentInstance.version = '12.0.1';
    fixture.componentInstance.deprecation = {
      reasons: ['Legacy', 'CriticalBugs'],
      message: 'Use the maintained package.',
      alternatePackage: { id: 'Example.Next', range: '>= 2.0.0' },
    };

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Deprecated (Legacy, Critical bugs)');
    expect(fixture.nativeElement.textContent).toContain('Use the maintained package.');
    expect(fixture.nativeElement.textContent.replace(/\s+/g, ' ')).toContain('Example.Next >= 2.0.0');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe(
      'https://www.nuget.org/packages/AutoMapper.Extensions.Microsoft.DependencyInjection/12.0.1'
    );
  });

  it.each([
    [{ reasons: ['Legacy'] }, 'Deprecated (Legacy)'],
    [{ message: 'No longer maintained.' }, 'No longer maintained.'],
    [{ alternatePackage: { id: 'Example.Next' } }, 'Example.Next'],
  ])('renders deprecation metadata when only one field is provided', (deprecation, expectedText) => {
    fixture.componentInstance.deprecation = deprecation;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(expectedText);
  });

  it('ignores unknown reasons and uses Other when none are recognized', () => {
    fixture.componentInstance.deprecation = { reasons: ['FutureReason'] };

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Deprecated (Other)');
    expect(fixture.nativeElement.textContent).not.toContain('FutureReason');
  });

  it.each([
    ['[13.0.0, )', '>= 13.0.0'],
    ['(13.0.0, )', '> 13.0.0'],
    ['[13.0.0, 14.0.0)', '>= 13.0.0 and < 14.0.0'],
    ['(, 14.0.0]', '<= 14.0.0'],
    ['[13.0.0]', '13.0.0'],
    ['[ ]', ''],
    ['[]', '[]'],
    ['[13.0.0,14.0.0]', '>= 13.0.0 and <= 14.0.0'],
    ['[[13.0.0]]', '[[13.0.0]]'],
    ['>= 13.0.0', '>= 13.0.0'],
  ])('formats alternate package range %s as %s', (range, expected) => {
    fixture.componentInstance.deprecation = { alternatePackage: { id: 'AutoMapper', range } };

    expect(fixture.componentInstance.alternatePackageRange).toBe(expected);
  });

  it('renders nothing when deprecation metadata is absent', () => {
    fixture.componentInstance.deprecation = undefined;

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('requests a search for the alternate package when its link is clicked', () => {
    fixture.componentInstance.deprecation = { alternatePackage: { id: 'AutoMapper', range: '[13.0.0, )' } };
    fixture.detectChanges();

    const link = fixture.nativeElement.querySelector('.alternate-package a') as HTMLAnchorElement;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);

    expect(packageManagerMock.requestPackageSearch).toHaveBeenCalledWith('AutoMapper');
    expect(click.defaultPrevented).toBe(true);
  });
});
