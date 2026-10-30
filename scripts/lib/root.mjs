import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repository root, whichever directory a script is run from. */
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
