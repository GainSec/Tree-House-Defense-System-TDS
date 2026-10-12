import { useEffect } from "react";

/** Dispose a memoised GPU resource when it is replaced or unmounted (R3F does not dispose geometry passed as a prop). */
export function useDisposable<T extends { dispose(): void }>(resource: T): T {
  useEffect(() => () => resource.dispose(), [resource]);
  return resource;
}
