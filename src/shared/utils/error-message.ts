export function formatErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error';
  }

  return sanitize(collectErrorParts(error).join('; ')).slice(0, 1500);
}

function collectErrorParts(error: unknown): string[] {
  const value = asRecord(error);
  const status = value?.['statusCode'] ?? value?.['status'];
  const statusText = value?.['statusMessage'] ?? value?.['statusText'];
  const parts: string[] = [];

  if (typeof status === 'number' && status > 0) {
    parts.push(formatStatus(status, statusText));
  }

  const message = error instanceof Error ? error.message : value?.['message'];
  appendMessage(parts, message, error);

  const details = value?.['error'] ?? value?.['body'] ?? value?.['details'] ?? value?.['detail'];
  if (details !== undefined && details !== error) {
    parts.push(`details: ${stringify(details)}`);
  }

  if (!parts.length) {
    parts.push(stringify(error));
  }
  return parts;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function formatStatus(status: number, statusText: unknown): string {
  const parts = [`HTTP ${status}`];
  if (typeof statusText === 'string' && statusText) {
    parts.push(statusText);
  }
  return parts.join(' ');
}

function appendMessage(parts: string[], message: unknown, error: unknown): void {
  if (typeof message === 'string' && message.trim()) {
    parts.push(parts.length ? `message: ${message}` : message);
  } else if (error instanceof Error && error.name !== 'Error') {
    parts.push(error.name);
  }
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function sanitize(value: string): string {
  return value
    .replace(/\b(Bearer|Basic)\s+\S+/gi, '$1 [redacted]')
    .replace(/(access[_-]?token|refresh[_-]?token)["']?\s*[:=]\s*["']?\S+/gi, '$1=[redacted]')
    .replace(/\b(token|password|secret|authorization)["']?\s*[:=]\s*["']?\S+/gi, '$1=[redacted]')
    .replace(/(api[_-]?key)["']?\s*[:=]\s*["']?\S+/gi, '$1=[redacted]')
    .replace(/(https?:\/\/[^\s"'<>]+)/gi, (match) => sanitizeUrl(match));
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of url.searchParams.keys()) {
      if (/token|password|secret|key|auth/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}
