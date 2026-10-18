import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

export const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
// npm workspaces start the API from apps/server, not the repository root.
config({ path: path.join(repoRoot, '.env'), quiet: true });

