import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { NuGetDataParsingError } from '../../shared/utils/nuget-data-parsing-error';
import ProjectFileLoader from './project-file-loader';

describe('ProjectFileLoader', () => {
  it('classifies malformed project XML as a data parsing error', async () => {
    const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nuget-assistant-project-'));
    const projectFilePath = path.join(temporaryFolder, 'project.csproj');
    await fs.writeFile(projectFilePath, '<Project><ItemGroup>');

    try {
      await expect(new ProjectFileLoader().loadProjectAsync(projectFilePath)).rejects.toBeInstanceOf(NuGetDataParsingError);
    } finally {
      await fs.rm(temporaryFolder, { recursive: true, force: true });
    }
  });

  it('loads package versions from the nearest central packages file', async () => {
    const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nuget-assistant-project-'));
    const projectFolder = path.join(temporaryFolder, 'src', 'app');
    const projectFilePath = path.join(projectFolder, 'app.csproj');
    await fs.mkdir(projectFolder, { recursive: true });
    await fs.writeFile(
      path.join(temporaryFolder, 'Directory.Packages.props'),
      '<Project><ItemGroup><PackageVersion Include="Shared.Package" Version="1.0.0" /><PackageVersion Include="Root.Package"><Version>2.0.0</Version></PackageVersion></ItemGroup></Project>'
    );
    await fs.writeFile(
      path.join(projectFolder, 'Directory.Packages.props'),
      '<Project><ItemGroup><PackageVersion Include="shared.package" Version="3.0.0" /><PackageVersion Include="No.Version" /><PackageVersion Version="4.0.0" /></ItemGroup></Project>'
    );
    await fs.writeFile(
      projectFilePath,
      '<Project><ItemGroup><PackageReference Include="Shared.Package" /><PackageReference Include="Root.Package" /><PackageReference Include="No.Version" /><PackageReference Include="Explicit.Package" Version="5.0.0" /></ItemGroup></Project>'
    );

    try {
      const project = await new ProjectFileLoader().loadProjectAsync(projectFilePath);

      expect(project.packages).toEqual([
        { id: 'Shared.Package', version: '3.0.0' },
        { id: 'Root.Package', version: '2.0.0' },
        { id: 'Explicit.Package', version: '5.0.0' },
      ]);
    } finally {
      await fs.rm(temporaryFolder, { recursive: true, force: true });
    }
  });

  it('classifies malformed central packages XML as a data parsing error', async () => {
    const temporaryFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'nuget-assistant-project-'));
    const projectFilePath = path.join(temporaryFolder, 'project.csproj');
    await fs.writeFile(path.join(temporaryFolder, 'Directory.Packages.props'), '<Project><ItemGroup>');
    await fs.writeFile(projectFilePath, '<Project><ItemGroup><PackageReference Include="Example" /></ItemGroup></Project>');

    try {
      await expect(new ProjectFileLoader().loadProjectAsync(projectFilePath)).rejects.toBeInstanceOf(NuGetDataParsingError);
    } finally {
      await fs.rm(temporaryFolder, { recursive: true, force: true });
    }
  });
});
