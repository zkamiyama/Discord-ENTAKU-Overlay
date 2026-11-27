/** A lease owns one reference, including while a resource is still loading.
 * Retired loads may finish, but can never be published into a replacement entry. */
export interface ResourceLease<T> { readonly ready: Promise<T>; release(): void }
interface Entry<T, S> {
  refs: number; retired: boolean; controller: AbortController; ready: Promise<T>;
  value?: { resource: T }; status: S; observers: Set<(status: S) => void>;
}
export class ResourceCache<T, S> {
  private readonly entries = new Map<string, Entry<T, S>>();
  private stopped = false;
  constructor(private readonly initial: S, private readonly destroy: (value: T) => void) {}
  get size(): number { return this.entries.size; }
  acquire(key: string, load: (signal: AbortSignal, status: (value: S) => void) => Promise<T>, observe: (status: S) => void = () => {}): ResourceLease<T> {
    if (this.stopped) throw new Error('GAUSSIAN_RUNTIME_DISPOSED');
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { refs: 0, retired: false, controller: new AbortController(), ready: undefined!, status: this.initial, observers: new Set() };
      const created = entry;
      this.entries.set(key, created);
      created.ready = Promise.resolve().then(() => load(created.controller.signal, status => {
        if (created.retired) return;
        created.status = status;
        for (const observer of [...created.observers]) {
          if (created.observers.has(observer)) observer(status);
        }
      })).then(value => {
        if (created.retired) { this.destroy(value); throw new Error('GAUSSIAN_LOAD_RETIRED'); }
        created.value = { resource: value };
        return value;
      });
      // A release may happen before the caller installs its own rejection handler.
      void created.ready.catch(() => {});
    }
    const acquired = entry;
    acquired.refs++;
    // A subscription belongs to a lease, not to the callback's identity.
    // UI observers must not reject a shared load or strand its reference.
    const notify = (status: S): void => { try { observe(status); } catch (error) { console.error('GAUSSIAN_STATUS_OBSERVER_FAILED', error); } };
    acquired.observers.add(notify);
    notify(acquired.status);
    let released = false;
    return { ready: acquired.ready, release: () => {
      if (released) return;
      released = true; acquired.observers.delete(notify);
      if (--acquired.refs === 0) this.retire(key, acquired);
    } };
  }
  private retire(key: string, entry: Entry<T, S>): void {
    if (entry.retired) return;
    entry.retired = true; entry.observers.clear();
    // Abort listeners run synchronously and may acquire the same key again.
    if (this.entries.get(key) === entry) this.entries.delete(key);
    entry.controller.abort();
    if (entry.value) { const { resource } = entry.value; entry.value = undefined; this.destroy(resource); }
  }
  snapshot(): ReadonlyArray<{key: string; references: number; value?: T; status: S}> {
    return [...this.entries].map(([key, e]) => ({ key, references: e.refs, value: e.value?.resource, status: e.status }));
  }
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const [key, entry] of this.entries) this.retire(key, entry);
  }
}
