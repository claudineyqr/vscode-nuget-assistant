import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProjectFileEditor } from './project-file-editor';

describe('ProjectFileEditor', () => {
  let tempFolder: string;
  let projectPath: string;
  let editor: ProjectFileEditor;

  beforeEach(() => {
    tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'nuget-assistant-project-editor-'));
    projectPath = path.join(tempFolder, 'Demo.csproj');
    editor = new ProjectFileEditor();
  });

  afterEach(() => {
    fs.rmSync(tempFolder, { recursive: true, force: true });
  });

  it('adds a package reference and restores the original project on rollback', () => {
    const original = '<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n';
    fs.writeFileSync(projectPath, original, 'utf8');

    const rollback = editor.apply(projectPath, 'Contoso.Widget', '2.1.0');

    expect(fs.readFileSync(projectPath, 'utf8')).toContain('<PackageReference Include="Contoso.Widget" Version="2.1.0" />');
    rollback();
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(original);
  });

  it('creates an item group when the project has none', () => {
    fs.writeFileSync(projectPath, '<Project>\n</Project>\n', 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', '2.1.0');

    expect(fs.readFileSync(projectPath, 'utf8')).toBe(
      '<Project>\n  <ItemGroup>\n    <PackageReference Include="Contoso.Widget" Version="2.1.0" />\n  </ItemGroup>\n</Project>\n'
    );
  });

  it('updates every matching reference without changing unrelated packages', () => {
    const original = [
      '<Project>',
      '  <ItemGroup>',
      '    <PackageReference Include="Contoso.Widget" Version="1.0.0" />',
      '    <PackageReference Include="Other.Package" Version="3.0.0" />',
      '    <PackageReference Update="CONTOSO.WIDGET"><Version>1.1.0</Version></PackageReference>',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    fs.writeFileSync(projectPath, original, 'utf8');

    editor.apply(projectPath, 'contoso.widget', '2.5.0');

    const updated = fs.readFileSync(projectPath, 'utf8');
    expect(updated.match(/Version="2\.5\.0"/g)).toHaveLength(1);
    expect(updated).toContain('<Version>2.5.0</Version>');
    expect(updated).toContain('Include="Other.Package" Version="3.0.0"');
  });

  it('updates single-quoted attributes and XML version elements', () => {
    const original = '<Project><ItemGroup><PackageReference Include=\'Contoso.Widget\' Version=\'1.0.0\' /><PackageReference Include="Other.Package"><Version>1.0.0</Version></PackageReference></ItemGroup></Project>';
    fs.writeFileSync(projectPath, original, 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', '2&3');
    editor.apply(projectPath, 'Other.Package', '4.5.0');

    const updated = fs.readFileSync(projectPath, 'utf8');
    expect(updated).toContain("Version='2&amp;3'");
    expect(updated).toContain('<Version>4.5.0</Version>');
  });

  it('applies several package updates together and rolls the whole batch back', () => {
    const original = [
      '<Project>',
      '  <ItemGroup>',
      '    <PackageReference Include="Contoso.Widget" Version="1.0.0" />',
      '    <PackageReference Include="Other.Package" Version="3.0.0" />',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    fs.writeFileSync(projectPath, original, 'utf8');

    const rollback = editor.applyMany(projectPath, [
      { packageId: 'Contoso.Widget', version: '2.0.0' },
      { packageId: 'Other.Package', version: '4.0.0' },
    ]);

    const updated = fs.readFileSync(projectPath, 'utf8');
    expect(updated).toContain('Contoso.Widget" Version="2.0.0"');
    expect(updated).toContain('Other.Package" Version="4.0.0"');
    rollback();
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(original);
  });

  it('updates central versions for multiple packages and restores both files on rollback', () => {
    const projectOriginal = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Contoso.Widget" />\n    <PackageReference Include="Other.Package" />\n  </ItemGroup>\n</Project>\n';
    const centralPath = path.join(tempFolder, 'Directory.Packages.props');
    const centralOriginal = '<Project>\n  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>\n  <ItemGroup><PackageVersion Include="Contoso.Widget" Version="1.0.0" /><PackageVersion Include="Other.Package" Version="1.0.0" /></ItemGroup>\n</Project>\n';
    fs.writeFileSync(projectPath, projectOriginal, 'utf8');
    fs.writeFileSync(centralPath, centralOriginal, 'utf8');

    const rollback = editor.applyMany(projectPath, [
      { packageId: 'Contoso.Widget', version: '2.0.0' },
      { packageId: 'Other.Package', version: '3.0.0' },
    ]);

    const updatedCentral = fs.readFileSync(centralPath, 'utf8');
    expect(updatedCentral).toContain('Contoso.Widget" Version="2.0.0"');
    expect(updatedCentral).toContain('Other.Package" Version="3.0.0"');
    rollback();
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(projectOriginal);
    expect(fs.readFileSync(centralPath, 'utf8')).toBe(centralOriginal);
  });

  it('removes matching package references and restores them on rollback', () => {
    const original = [
      '<Project>',
      '  <ItemGroup>',
      '    <PackageReference Include="Contoso.Widget" Version="1.0.0" />',
      '    <PackageReference Include="Other.Package" Version="3.0.0" />',
      '  </ItemGroup>',
      '</Project>',
    ].join('\n');
    fs.writeFileSync(projectPath, original, 'utf8');

    const rollback = editor.apply(projectPath, 'Contoso.Widget', undefined);

    expect(fs.readFileSync(projectPath, 'utf8')).not.toContain('Contoso.Widget');
    expect(fs.readFileSync(projectPath, 'utf8')).toContain('Other.Package');
    rollback();
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(original);
  });

  it('removes the complete reference line from a CRLF project file', () => {
    const original = '<Project>\r\n  <ItemGroup>\r\n    <PackageReference Include="Contoso.Widget" Version="1.0.0" />\r\n    <PackageReference Include="Other.Package" Version="3.0.0" />\r\n  </ItemGroup>\r\n</Project>\r\n';
    const expected = '<Project>\r\n  <ItemGroup>\r\n    <PackageReference Include="Other.Package" Version="3.0.0" />\r\n  </ItemGroup>\r\n</Project>\r\n';
    fs.writeFileSync(projectPath, original, 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', undefined);

    expect(fs.readFileSync(projectPath, 'utf8')).toBe(expected);
  });

  it('removes a multiline reference with child elements and keeps adjacent inline XML', () => {
    const original = '<Project><ItemGroup><PackageReference Include="Contoso.Widget">\n  <Version>1.0.0</Version>\n</PackageReference><PackageReference Include="Other.Package" /></ItemGroup></Project>';
    fs.writeFileSync(projectPath, original, 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', undefined);

    expect(fs.readFileSync(projectPath, 'utf8')).toBe('<Project><ItemGroup><PackageReference Include="Other.Package" /></ItemGroup></Project>');
  });

  it('does not remove package references found only in XML comments', () => {
    const original = '<Project>\n  <!-- <PackageReference Include="Contoso.Widget" Version="1.0.0" /> -->\n</Project>\n';
    fs.writeFileSync(projectPath, original, 'utf8');

    expect(() => editor.apply(projectPath, 'Contoso.Widget', undefined))
      .toThrow('Package Contoso.Widget is not referenced by Demo.csproj.');
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(original);
  });

  it('updates central package versions and rolls back both project files', () => {
    const projectOriginal = '<Project>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n';
    const centralPath = path.join(tempFolder, 'Directory.Packages.props');
    const centralOriginal = '<Project>\n  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>\n</Project>\n';
    fs.writeFileSync(projectPath, projectOriginal, 'utf8');
    fs.writeFileSync(centralPath, centralOriginal, 'utf8');

    const rollback = editor.apply(projectPath, 'Contoso.Widget', '2.1.0');

    expect(fs.readFileSync(projectPath, 'utf8')).toContain('<PackageReference Include="Contoso.Widget" />');
    expect(fs.readFileSync(centralPath, 'utf8')).toContain('<PackageVersion Include="Contoso.Widget" Version="2.1.0" />');
    rollback();
    expect(fs.readFileSync(projectPath, 'utf8')).toBe(projectOriginal);
    expect(fs.readFileSync(centralPath, 'utf8')).toBe(centralOriginal);
  });

  it('adds missing central version entries when central version management is enabled', () => {
    const projectOriginal = '<Project>\n  <ItemGroup>\n    <PackageReference Include="Contoso.Widget" Version="1.0.0" />\n  </ItemGroup>\n</Project>\n';
    const centralPath = path.join(tempFolder, 'Directory.Packages.props');
    const centralOriginal = '<Project>\n  <PropertyGroup><ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally></PropertyGroup>\n  <ItemGroup>\n  </ItemGroup>\n</Project>\n';
    fs.writeFileSync(projectPath, projectOriginal, 'utf8');
    fs.writeFileSync(centralPath, centralOriginal, 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', '2.1.0');

    expect(fs.readFileSync(projectPath, 'utf8')).toContain('<PackageReference Include="Contoso.Widget" />');
    expect(fs.readFileSync(centralPath, 'utf8')).toContain('<PackageVersion Include="Contoso.Widget" Version="2.1.0" />');
  });

  it('uses an existing central entry and removes local version declarations', () => {
    const projectOriginal = '<Project><ItemGroup><PackageReference Include="Contoso.Widget" Version="1.0.0" VersionOverride="1.5.0"><Version>1.2.0</Version><VersionOverride>1.7.0</VersionOverride></PackageReference></ItemGroup></Project>';
    const centralPath = path.join(tempFolder, 'Directory.Packages.props');
    const centralOriginal = '<Project><ItemGroup><PackageVersion Include="Contoso.Widget" Version="1.0.0" /></ItemGroup></Project>';
    fs.writeFileSync(projectPath, projectOriginal, 'utf8');
    fs.writeFileSync(centralPath, centralOriginal, 'utf8');

    editor.apply(projectPath, 'Contoso.Widget', '2.0.0');

    expect(fs.readFileSync(projectPath, 'utf8')).toBe('<Project><ItemGroup><PackageReference Include="Contoso.Widget"></PackageReference></ItemGroup></Project>');
    expect(fs.readFileSync(centralPath, 'utf8')).toContain('Version="2.0.0"');
  });

  it('throws when removing a package that is not referenced', () => {
    fs.writeFileSync(projectPath, '<Project></Project>', 'utf8');

    expect(() => editor.apply(projectPath, 'Missing.Package', undefined))
      .toThrow('Package Missing.Package is not referenced by Demo.csproj.');
    expect(fs.readFileSync(projectPath, 'utf8')).toBe('<Project></Project>');
  });
});
