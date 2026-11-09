const CSP = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; connect-src 'self' blob: data:; img-src 'self' blob: data:; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
export function headers(type = 'application/json'): Record<string,string> {
  return { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': CSP };
}
export function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: headers() }); }
export const assetErrors = new Set(['IMAGE_TOO_LARGE','IMAGE_DIMENSIONS_REJECTED','INVALID_IMAGE','ANIMATED_IMAGE_REJECTED','IMAGE_FORMAT_REJECTED','ASSET_STORE_FULL','ASSET_NOT_FOUND','INVALID_AVATAR_PROFILE','INVALID_FACE_RECT','INVALID_FRAMING_RECT','FRAMING_MUST_INCLUDE_FACE','FACE_RECT_TOO_SMALL','INVALID_AVATAR_TRANSFORM','AVATAR_TOO_WIDE','AVATAR_TOO_TALL','AVATAR_SETTINGS_WRITE_FAILED','TOO_MANY_AVATAR_PROFILES']);
