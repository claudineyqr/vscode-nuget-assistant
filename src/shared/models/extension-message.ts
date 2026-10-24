import { PackageSource } from './package-source';
import { Project, ProjectSet } from './project';

export interface ExtensionMessage {
  type: string;
  data: Project | ProjectSet | PackageSource[];
  selectedSourceUrl?: string;
}
