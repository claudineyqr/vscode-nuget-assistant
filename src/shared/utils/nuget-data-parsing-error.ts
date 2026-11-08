export class NuGetDataParsingError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'NuGetDataParsingError';
  }
}

export function isNuGetDataParsingError(error: unknown): error is NuGetDataParsingError {
  return error instanceof NuGetDataParsingError;
}
