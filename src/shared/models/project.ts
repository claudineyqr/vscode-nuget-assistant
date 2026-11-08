export interface Project {
  name: string;
  fsPath: string;
  packages: InstalledPackage[];
}

export interface ProjectSet {
  name: string;
  fsPath: string;
  projects: Project[];
}

export interface InstalledPackage {
  id: string;
  version: string;
}
