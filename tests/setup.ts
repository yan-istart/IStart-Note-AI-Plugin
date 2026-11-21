// xterm's UMD bundles reference `self`; provide it in the Node test environment.
const scope = globalThis as { self?: unknown };
if (typeof scope.self === "undefined") scope.self = globalThis;
