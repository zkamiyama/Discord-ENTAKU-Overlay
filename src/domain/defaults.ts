/** Values approved in the v0.1 specification. Distances are metres. */
export const TABLE = Object.freeze({
  innerRadius: 0.75, ringWidth: 0.65, avatarOffset: 0.5,
  topY: 0.75, thickness: 0.06, seatPitch: 1.1,
  minSeats: 4, maxSeats: 32, phase: 0.5, growthDurationMs: 1200,
});
export const DIRECTOR = Object.freeze({
  gapToleranceMs: 250, minSpeechRatio: 0.75,
  dominanceRatio: 1.6, dominanceMarginMs: 1000,
});
export const APP = Object.freeze({
  host: '127.0.0.1', port: 31337, protocolVersion: 1,
  maxFrameBytes: 8 * 1024 * 1024, rpcTimeoutMs: 5000,
  authTimeoutMs: 120000, heartbeatMs: 5000,
});
