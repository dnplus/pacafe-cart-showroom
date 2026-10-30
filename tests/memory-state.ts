/** Durable Object storage as the KV API shows it: values come back as copies, as they do from the real store. */
export function memoryState() {
  const data = new Map<string, unknown>();
  const storage = {
    async get(key: string) { return structuredClone(data.get(key)); },
    async put(keyOrEntries: string | Record<string, unknown>, value?: unknown) {
      const entries: [string, unknown][] = typeof keyOrEntries === 'string' ? [[keyOrEntries, value]] : Object.entries(keyOrEntries);
      for (const [key, entry] of entries) data.set(key, structuredClone(entry));
    },
  };
  return { storage } as unknown as DurableObjectState;
}

/** The slice of an R2 bucket the worker uses: put (with custom metadata), get (with a `bytes=a-b` range), head and delete. */
export function memoryBucket() {
  type Entry = { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> };
  const data = new Map<string, Entry>();
  const object = (key: string, entry: Entry, range?: { offset: number; length: number }) => ({
    key, size: entry.bytes.length, httpEtag: `"${key}"`, range,
    httpMetadata: { contentType: entry.contentType }, customMetadata: entry.customMetadata,
    writeHttpMetadata(headers: Headers) { if (entry.contentType) headers.set('content-type', entry.contentType); },
    body: new Blob([range ? entry.bytes.slice(range.offset, range.offset + range.length) : entry.bytes.slice()]).stream(),
    arrayBuffer: async () => entry.bytes.slice().buffer,
    text: async () => new TextDecoder().decode(entry.bytes),
  });
  const bucket = {
    data,
    async put(key: string, value: ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value instanceof Uint8Array ? value : new Uint8Array(value)).slice();
      data.set(key, { bytes, contentType: options?.httpMetadata?.contentType, customMetadata: options?.customMetadata });
      return { key, size: bytes.length };
    },
    async get(key: string, options?: { range?: Headers }) {
      const entry = data.get(key); if (!entry) return null;
      const asked = /^bytes=(\d+)-(\d*)$/.exec(options?.range?.get('range') ?? '');
      const range = asked ? { offset: Number(asked[1]), length: (asked[2] ? Number(asked[2]) + 1 : entry.bytes.length) - Number(asked[1]) } : undefined;
      return object(key, entry, range);
    },
    async head(key: string) { const entry = data.get(key); return entry ? object(key, entry) : null; },
    async delete(keys: string | string[]) { for (const key of [keys].flat()) data.delete(key); },
  };
  return bucket as typeof bucket & R2Bucket;
}
