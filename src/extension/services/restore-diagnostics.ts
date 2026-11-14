const diagnosticStart = /\b(error|warning)\s+([A-Z]+\d+)\s*:/i;

export function findFailedPackageIds(diagnostics: string, packageIds: string[]): string[] {
  const errorBlocks: string[] = [];
  let currentError: string[] | undefined;

  for (const line of diagnostics.split(/\r?\n/)) {
    const diagnostic = diagnosticStart.exec(line);
    const prefix = diagnostic ? line.slice(0, diagnostic.index).trimEnd() : '';
    if (diagnostic && (prefix.length === 0 || prefix.endsWith(':'))) {
      if (currentError) {
        errorBlocks.push(currentError.join('\n'));
        currentError = undefined;
      }
      if (diagnostic[1].toLowerCase() === 'error' && diagnostic[2].toUpperCase().startsWith('NU')) {
        currentError = [line];
      }
    } else if (currentError) {
      currentError.push(line);
    }
  }

  if (currentError) {
    errorBlocks.push(currentError.join('\n'));
  }

  const errorText = errorBlocks.join('\n');
  return packageIds.filter((packageId) => {
    const escapedId = packageId.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const packageIdPattern = new RegExp(String.raw`(?<![A-Za-z0-9_.-])${escapedId}(?![A-Za-z0-9_-]|\.[A-Za-z0-9_-])`, 'i');
    return packageIdPattern.test(errorText);
  });
}
