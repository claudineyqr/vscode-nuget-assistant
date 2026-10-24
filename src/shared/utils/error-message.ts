export function formatErrorMessage(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error';
  }

  const value = typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const message = error instanceof Error ? error.message : value?.['message'];
  const status = value?.['statusCode'] ?? value?.['status'];
  const statusText = value?.['statusMessage'] ?? value?.['statusText'];
  const parts: string[] = [];

  if (typeof status === 'number' && status > 0) {
    parts.push(`HTTP ${status}${typeof statusText === 'string' && statusText ? ` ${statusText}` : ''}`);
  }
  if (typeof message === 'string' && message.trim()) {
    parts.push(parts.length ? `message: ${message}` : message);
  } else if (error instanceof Error && error.name !== 'Error') {
    parts.push(error.name);
  }

  const details = value?.['error'] ?? value?.['body'] ?? value?.['details'] ?? value?.['detail'];
  if (details !== undefined && details !== error) {
    parts.push(`details: ${stringify(details)}`);
  }

  if (!parts.length) {
    parts.push(stringify(error));
  }

  return sanitize(parts.join('; ')).slice(0, 1500);
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
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[credentials-redacted]@')
    .replace(/(["']?(?:access[_-]?token|refresh[_-]?token|token|password|secret|api[_-]?key|authorization)["']?\s*[:=]\s*["']?)[^"',}\s]+/gi, '$1[redacted]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/=._~-]+/gi, '$1 [redacted]')
    .replace(/(https?:\/\/[^\s"'<>]+)/gi, (match) => sanitizeUrl(match));
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/token|password|secret|key|auth/i.test(key)) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return url.toString();
  } catch {
    return value;
  }
}
