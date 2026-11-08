import { gunzip } from 'node:zlib';

export function decodeNuGetResponseBody(body: Buffer, contentEncoding: string | string[] | undefined): Promise<Buffer> {
  const encodings = (Array.isArray(contentEncoding) ? contentEncoding : [contentEncoding ?? ''])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (!encodings.length || encodings.every((encoding) => encoding === 'identity')) {
    return Promise.resolve(body);
  }
  if (encodings.length !== 1 || encodings[0] !== 'gzip') {
    return Promise.reject(new Error(`Unsupported NuGet response content encoding: ${encodings.join(', ')}.`));
  }

  return new Promise((resolve, reject) => {
    gunzip(body, (error, decodedBody) => {
      if (error) {
        reject(new Error('The NuGet source returned an invalid gzip response.'));
        return;
      }
      resolve(decodedBody);
    });
  });
}
