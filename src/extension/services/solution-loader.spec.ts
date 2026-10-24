import * as path from 'path';
import ProjectFileLoader from './project-file-loader';
import SolutionLoader from './solution-loader';

describe('SolutionLoader', () => {
  it('should resolve and deduplicate project paths from a sln file', () => {
    const solutionPath = path.join('workspace', 'sample.sln');
    const solutionContent = [
      'Project("{GUID}") = "App", "src\\App\\App.csproj", "{APP}"',
      'Project("{GUID}") = "App Duplicate", "src\\App\\App.csproj", "{APP2}"',
      'Project("{GUID}") = "Library", "src\\Library\\Library.csproj", "{LIB}"',
    ].join('\n');
    const loader = new SolutionLoader({} as ProjectFileLoader, { readFileSync: () => solutionContent });

    expect(loader.readProjectPaths(solutionPath)).toEqual([
      path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj')),
      path.normalize(path.resolve('workspace', 'src', 'Library', 'Library.csproj')),
    ]);
  });

  it('should resolve project paths from a slnx file', () => {
    const solutionPath = path.join('workspace', 'sample.slnx');
    const loader = new SolutionLoader({} as ProjectFileLoader, {
      readFileSync: () => '<Solution><Project Path="src/App/App.csproj" /><Project Path="src/Lib/Lib.fsproj" /></Solution>',
    });

    expect(loader.readProjectPaths(solutionPath)).toEqual([
      path.normalize(path.resolve('workspace', 'src', 'App', 'App.csproj')),
      path.normalize(path.resolve('workspace', 'src', 'Lib', 'Lib.fsproj')),
    ]);
  });
});
