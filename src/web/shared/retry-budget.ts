/** Two delayed retries per owner key. Callers poll without scheduling timers;
 * a changed key starts a fresh budget, and success clears prior failures. */
export class RetryBudget {
  private key = '';
  private failures = 0;
  private retryAt = 0;
  constructor(private clock: () => number = () => performance.now()) {}
  canAttempt(key: string): boolean {
    if (key !== this.key) {this.reset();this.key = key;}
    return this.clock() >= this.retryAt;
  }
  failed(): void {
    this.failures++;
    this.retryAt = this.failures <= 2 ? this.clock() + [500,2000][this.failures - 1]! : Infinity;
  }
  succeeded(): void {this.failures = 0;this.retryAt = 0;}
  reset(): void {this.key = '';this.succeeded();}
}
