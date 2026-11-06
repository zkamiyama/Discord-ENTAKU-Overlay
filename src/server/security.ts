/** A loopback-only service. Do not accept browser requests to alternate hostnames. */
export function validHost(request: Request, port: number): boolean {
  return request.headers.get('host') === `127.0.0.1:${port}`;
}
/** Protect state-changing HTTP requests and WebSocket upgrades from other origins.
 * This is not an authorization boundary against local programs.
 */
export function validOrigin(request: Request, port: number): boolean {
  return request.headers.get('origin') === `http://127.0.0.1:${port}`;
}
