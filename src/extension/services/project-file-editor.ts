import * as fs from 'node:fs';
import * as path from 'node:path';

interface FileSnapshot {
  path: string;
  content: string | undefined;
}

interface PackageReferenceMatch {
  start: number;
  end: number;
  text: string;
  id: string | undefined;
}

interface EditPlan {
  projectPath: string;
  projectContent: string;
  updatedProject: string;
  centralPath: string | undefined;
  centralContent: string | undefined;
  updatedCentral: string | undefined;
  snapshots: FileSnapshot[];
}

export interface PackageVersionUpdate {
  packageId: string;
  version: string;
}

export class ProjectFileEditor {
  public apply(projectPath: string, packageId: string, version: string | undefined): () => void {
    const plan = this.createEditPlan(projectPath, packageId, version);
    this.writeChanges(plan);
    return () => this.restore(plan.snapshots);
  }

  public applyMany(projectPath: string, updates: PackageVersionUpdate[]): () => void {
    if (updates.length === 0) {
      return () => undefined;
    }

    const projectContent = fs.readFileSync(projectPath, 'utf8');
    const centralPath = this.findCentralPackagesFile(path.dirname(projectPath));
    const centralContent = centralPath ? fs.readFileSync(centralPath, 'utf8') : undefined;
    const plan: EditPlan = {
      projectPath,
      projectContent,
      updatedProject: projectContent,
      centralPath,
      centralContent,
      updatedCentral: centralContent,
      snapshots: [{ path: projectPath, content: projectContent }],
    };

    for (const update of updates) {
      const usesCentralVersions = this.usesCentralVersions(plan.updatedCentral, update.packageId);
      const matches = this.findReferences(plan.updatedProject, 'PackageReference', update.packageId);
      plan.updatedProject = this.updateProjectReference(
        plan.updatedProject,
        matches,
        update.packageId,
        update.version,
        usesCentralVersions
      );
      if (usesCentralVersions) {
        this.updateCentralPackageVersion(plan, update.packageId, update.version);
      }
    }

    this.writeChanges(plan);
    return () => this.restore(plan.snapshots);
  }

  private createEditPlan(projectPath: string, packageId: string, version: string | undefined): EditPlan {
    const projectContent = fs.readFileSync(projectPath, 'utf8');
    const centralPath = this.findCentralPackagesFile(path.dirname(projectPath));
    const centralContent = centralPath ? fs.readFileSync(centralPath, 'utf8') : undefined;
    const usesCentralVersions = this.usesCentralVersions(centralContent, packageId);
    const projectMatches = this.findReferences(projectContent, 'PackageReference', packageId);
    const basePlan: EditPlan = {
      projectPath,
      projectContent,
      updatedProject: projectContent,
      centralPath,
      centralContent,
      updatedCentral: centralContent,
      snapshots: [{ path: projectPath, content: projectContent }],
    };

    return version === undefined
      ? this.planRemoval(basePlan, projectMatches, packageId)
      : this.planVersionUpdate(basePlan, projectMatches, packageId, version, usesCentralVersions);
  }

  private usesCentralVersions(centralContent: string | undefined, packageId: string): boolean {
    if (centralContent === undefined) {
      return false;
    }
    const centralEnabled = /<ManagePackageVersionsCentrally\b[^>]*>\s*true\s*<\/ManagePackageVersionsCentrally>/i.test(centralContent);
    const centralEntryExists = this.findReferences(centralContent, 'PackageVersion', packageId).length > 0;
    return centralEnabled || centralEntryExists;
  }

  private planRemoval(plan: EditPlan, matches: PackageReferenceMatch[], packageId: string): EditPlan {
    if (matches.length === 0) {
      throw new Error(`Package ${packageId} is not referenced by ${path.basename(plan.projectPath)}.`);
    }
    plan.updatedProject = this.removeReferences(plan.projectContent, matches);
    return plan;
  }

  private planVersionUpdate(
    plan: EditPlan,
    matches: PackageReferenceMatch[],
    packageId: string,
    version: string,
    usesCentralVersions: boolean,
  ): EditPlan {
    plan.updatedProject = this.updateProjectReference(plan.projectContent, matches, packageId, version, usesCentralVersions);
    if (usesCentralVersions) {
      this.updateCentralPackageVersion(plan, packageId, version);
    }
    return plan;
  }

  private updateProjectReference(
    projectContent: string,
    matches: PackageReferenceMatch[],
    packageId: string,
    version: string,
    usesCentralVersions: boolean,
  ): string {
    if (matches.length > 0) {
      return this.updateReferences(projectContent, matches, version, usesCentralVersions);
    }
    const renderedReference = usesCentralVersions
      ? `<PackageReference Include="${this.escapeAttribute(packageId)}" />`
      : `<PackageReference Include="${this.escapeAttribute(packageId)}" Version="${this.escapeAttribute(version)}" />`;
    return this.insertItem(projectContent, 'PackageReference', renderedReference);
  }

  private updateCentralPackageVersion(plan: EditPlan, packageId: string, version: string): void {
    if (!plan.centralPath || plan.updatedCentral === undefined) {
      throw new Error(`Central package management is enabled but Directory.Packages.props was not found for ${plan.projectPath}.`);
    }
    const matches = this.findReferences(plan.updatedCentral, 'PackageVersion', packageId);
    const renderedVersion = `<PackageVersion Include="${this.escapeAttribute(packageId)}" Version="${this.escapeAttribute(version)}" />`;
    plan.updatedCentral = matches.length > 0
      ? this.updateReferences(plan.updatedCentral, matches, version, false)
      : this.insertItem(plan.updatedCentral, 'PackageVersion', renderedVersion);
    if (plan.updatedCentral !== plan.centralContent && !plan.snapshots.some((snapshot) => snapshot.path === plan.centralPath)) {
      plan.snapshots.push({ path: plan.centralPath, content: plan.centralContent });
    }
  }

  private writeChanges(plan: EditPlan): void {
    try {
      fs.writeFileSync(plan.projectPath, plan.updatedProject, 'utf8');
      if (plan.updatedCentral !== undefined && plan.centralPath && plan.updatedCentral !== plan.centralContent) {
        fs.writeFileSync(plan.centralPath, plan.updatedCentral, 'utf8');
      }
    } catch (error) {
      this.restore(plan.snapshots);
      throw error;
    }
  }

  private findCentralPackagesFile(startFolder: string): string | undefined {
    let currentFolder = startFolder;
    while (true) {
      const candidate = path.join(currentFolder, 'Directory.Packages.props');
      if (fs.existsSync(candidate)) {
        const content = fs.readFileSync(candidate, 'utf8');
        if (/<PackageVersion\b/i.test(content) || /<ManagePackageVersionsCentrally\b[^>]*>\s*true\s*</i.test(content)) {
          return candidate;
        }
      }
      const parentFolder = path.dirname(currentFolder);
      if (parentFolder === currentFolder) {
        return undefined;
      }
      currentFolder = parentFolder;
    }
  }

  private findReferences(content: string, elementName: string, packageId: string): PackageReferenceMatch[] {
    const escapedName = elementName.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(String.raw`<${escapedName}\b(?=[^>]*\/)\s*[^>]*\/>|<${escapedName}\b[^>]*>[\s\S]*?<\/${escapedName}\s*>`, 'gi');
    const searchableContent = content.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, ' '));
    const matches: PackageReferenceMatch[] = [];
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(searchableContent)) !== null) {
      const id = /\b(?:Include|Update)\s*=\s*(["'])(.*?)\1/i.exec(match[0])?.[2];
      if (id?.toLowerCase() === packageId.toLowerCase()) {
        matches.push({ start: match.index, end: pattern.lastIndex, text: content.slice(match.index, pattern.lastIndex), id });
      }
    }
    return matches;
  }

  private removeReferences(content: string, matches: PackageReferenceMatch[]): string {
    for (const match of [...matches].reverse()) {
      let start = match.start;
      let end = match.end;
      const lineStart = content.lastIndexOf('\n', start - 1) + 1;
      const lineEnd = content.indexOf('\n', end);
      const trailingEnd = lineEnd < 0 ? content.length : lineEnd;
      const prefix = content.slice(lineStart, start);
      const suffix = content.slice(end, trailingEnd);

      if (/^[\t ]*$/.test(prefix) && /^[\t \r]*$/.test(suffix)) {
        start = lineStart;
        end = lineEnd < 0 ? content.length : lineEnd + 1;
      }

      content = content.slice(0, start) + content.slice(end);
    }
    return content;
  }

  private updateReferences(content: string, matches: PackageReferenceMatch[], version: string, removeVersion: boolean): string {
    for (const match of [...matches].reverse()) {
      let updated = match.text;
      if (removeVersion) {
        updated = this.removeAttribute(updated, 'Version');
        updated = this.removeAttribute(updated, 'VersionOverride');
        updated = updated.replace(/<Version(?:Override)?\b[^>]*>[\s\S]*?<\/Version(?:Override)?\s*>/gi, '');
      } else {
        const attrPattern = /\bVersion\s*=\s*("[^"]*"|'[^']*')/i;
        if (attrPattern.test(updated)) {
          updated = updated.replace(attrPattern, (_whole, value: string) => `Version=${value[0]}${this.escapeAttribute(version)}${value[0]}`);
        } else if (/<Version\b/i.test(updated)) {
          updated = updated.replace(/(<Version\b[^>]*>)[\s\S]*?(<\/Version\s*>)/i, `$1${this.escapeText(version)}$2`);
        } else if (updated.trimEnd().endsWith('/>')) {
          const closingTagIndex = updated.lastIndexOf('/>');
          updated = `${updated.slice(0, closingTagIndex).trimEnd()} Version="${this.escapeAttribute(version)}" />`;
        } else {
          updated = updated.replace(/^(<[^>]+>)/, `$1<Version>${this.escapeText(version)}</Version>`);
        }
        updated = updated.replace(/\bVersionOverride\s*=\s*("[^"]*"|'[^']*')/i, (_whole, value: string) => `VersionOverride=${value[0]}${this.escapeAttribute(version)}${value[0]}`);
        updated = updated.replace(/(<VersionOverride\b[^>]*>)[\s\S]*?(<\/VersionOverride\s*>)/i, `$1${this.escapeText(version)}$2`);
      }
      content = content.slice(0, match.start) + updated + content.slice(match.end);
    }
    return content;
  }

  private removeAttribute(element: string, attributeName: string): string {
    const searchableElement = element.toLowerCase();
    const searchableName = attributeName.toLowerCase();
    let searchIndex = 0;

    while (searchIndex < element.length) {
      const attributeIndex = searchableElement.indexOf(searchableName, searchIndex);
      if (attributeIndex < 0) {
        return element;
      }
      searchIndex = attributeIndex + searchableName.length;
      if (attributeIndex === 0 || !/\s/.test(element[attributeIndex - 1])) {
        continue;
      }

      let valueIndex = this.skipWhitespace(element, searchIndex);
      if (element[valueIndex] !== '=') {
        continue;
      }
      valueIndex = this.skipWhitespace(element, valueIndex + 1);
      const quote = element[valueIndex];
      if (quote !== '"' && quote !== "'") {
        continue;
      }
      const valueEnd = element.indexOf(quote, valueIndex + 1);
      if (valueEnd < 0) {
        continue;
      }

      let attributeStart = attributeIndex;
      while (attributeStart > 0 && /\s/.test(element[attributeStart - 1])) {
        attributeStart -= 1;
      }
      return element.slice(0, attributeStart) + element.slice(valueEnd + 1);
    }
    return element;
  }

  private skipWhitespace(value: string, startIndex: number): number {
    let index = startIndex;
    while (index < value.length && /\s/.test(value[index])) {
      index += 1;
    }
    return index;
  }

  private insertItem(content: string, elementName: string, item: string): string {
    const itemGroup = /<ItemGroup\b[^>]*>[\s\S]*?<\/ItemGroup\s*>/i.exec(content);
    if (itemGroup) {
      const closeOffset = itemGroup.index + itemGroup[0].lastIndexOf('</ItemGroup');
      const groupIndent = this.getIndent(content, itemGroup.index);
      const itemPattern = new RegExp(String.raw`<${elementName}\b`, 'i');
      const existingItem = itemPattern.exec(itemGroup[0]);
      const indent = existingItem
        ? this.getIndent(content, itemGroup.index + existingItem.index)
        : `${groupIndent}  `;
      const lineStart = content.lastIndexOf('\n', closeOffset - 1) + 1;
      const closeLinePrefix = content.slice(lineStart, closeOffset);
      const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';

      if (/^[\t ]*$/.test(closeLinePrefix)) {
        return content.slice(0, lineStart) + `${indent}${item}${lineEnding}` + content.slice(lineStart);
      }

      return content.slice(0, closeOffset) + `${lineEnding}${indent}${item}${lineEnding}${groupIndent}` + content.slice(closeOffset);
    }
    const projectClose = content.lastIndexOf('</Project>');
    if (projectClose < 0) {
      throw new Error(`Could not find the closing Project element for ${elementName}.`);
    }
    const projectIndent = this.getIndent(content, projectClose);
    const itemGroupIndent = `${projectIndent}  `;
    const projectLineStart = content.lastIndexOf('\n', projectClose - 1) + 1;
    const projectLinePrefix = content.slice(projectLineStart, projectClose);
    const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
    if (/^[\t ]*$/.test(projectLinePrefix)) {
      return content.slice(0, projectLineStart)
        + `${itemGroupIndent}<ItemGroup>${lineEnding}${itemGroupIndent}  ${item}${lineEnding}${itemGroupIndent}</ItemGroup>${lineEnding}`
        + content.slice(projectLineStart);
    }
    return content.slice(0, projectClose)
      + `${lineEnding}${itemGroupIndent}<ItemGroup>${lineEnding}${itemGroupIndent}  ${item}${lineEnding}${itemGroupIndent}</ItemGroup>${lineEnding}${projectIndent}`
      + content.slice(projectClose);
  }

  private getIndent(content: string, offset: number): string {
    const lineStart = content.lastIndexOf('\n', offset - 1) + 1;
    return /^[\t ]*/.exec(content.slice(lineStart, offset))?.[0] ?? '';
  }

  private escapeAttribute(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;');
  }

  private escapeText(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  private restore(snapshots: FileSnapshot[]): void {
    for (const snapshot of snapshots) {
      if (snapshot.content !== undefined) {
        fs.writeFileSync(snapshot.path, snapshot.content, 'utf8');
      } else if (fs.existsSync(snapshot.path)) {
        fs.unlinkSync(snapshot.path);
      }
    }
  }
}
