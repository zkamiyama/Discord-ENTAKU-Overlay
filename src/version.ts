import manifest from '../package.json';
export const VERSION = manifest.version;
export const BUN_VERSION = manifest.packageManager.replace(/^bun@/, '');
