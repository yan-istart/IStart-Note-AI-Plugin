/** Copy trusted, JSON-serializable application state without sharing nested references. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
