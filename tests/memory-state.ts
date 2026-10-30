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
