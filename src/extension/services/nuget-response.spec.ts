import { gzipSync } from 'node:zlib';
import { decodeNuGetResponseBody } from './nuget-response';

describe('decodeNuGetResponseBody', () => {
  it('decodes gzip NuGet responses', async () => {
    const expected = Buffer.from('{"count":1,"items":[]}');

    await expect(decodeNuGetResponseBody(gzipSync(expected), 'gzip')).resolves.toEqual(expected);
  });

  it('passes through uncompressed responses', async () => {
    const body = Buffer.from('{"versions":["1.0.0"]}');

    await expect(decodeNuGetResponseBody(body, undefined)).resolves.toBe(body);
    await expect(decodeNuGetResponseBody(body, 'identity')).resolves.toBe(body);
  });

  it('rejects unsupported response encodings', async () => {
    await expect(decodeNuGetResponseBody(Buffer.from('body'), 'br')).rejects.toThrow('Unsupported NuGet response content encoding: br.');
  });
});
