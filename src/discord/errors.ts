export class DiscordError extends Error {
  constructor(readonly code: string, readonly rpcCode?: number) {
    // Never include upstream payloads, codes or tokens in the Error message.
    super(code);
    this.name = 'DiscordError';
  }
}
export function errorCode(error: unknown): string {
  return error instanceof DiscordError ? error.code : 'INTERNAL_ERROR';
}
