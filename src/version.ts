import manifest from '../package.json';
/** Release candidate: real Discord/OBS acceptance is tracked separately. */
export const VERSION = manifest.version;
export const BUN_VERSION = manifest.packageManager.replace(/^bun@/, '');
