import { findFailedPackageIds } from './restore-diagnostics';

describe('findFailedPackageIds', () => {
  it('finds selected package ids in NuGet error diagnostics and their detail lines', () => {
    const diagnostics = [
      'Demo.csproj : error NU1101: Unable to find package Missing.Package.',
      '  Demo -> Missing.Package (>= 2.0.0)',
      'Demo.csproj : warning NU1605: Package downgrade for Safe.Package.',
    ].join('\n');

    expect(findFailedPackageIds(diagnostics, ['Missing.Package', 'Safe.Package', 'Other.Package']))
      .toEqual(['Missing.Package']);
  });

  it('matches package ids case-insensitively with package id boundaries', () => {
    const diagnostics = 'error NU1101: Unable to find package Contoso.Widget.Extras.';

    expect(findFailedPackageIds(diagnostics, ['Contoso.Widget', 'contoso.widget.extras']))
      .toEqual(['contoso.widget.extras']);
  });

  it('does not infer a failed package from ordinary output or warnings', () => {
    const diagnostics = [
      'Restoring Contoso.Widget...',
      'error NU1101: Unable to find package Missing.Package.',
      'warning NU1605: Package downgrade for Contoso.Widget.',
    ].join('\n');

    expect(findFailedPackageIds(diagnostics, ['Contoso.Widget'])).toEqual([]);
  });
});
