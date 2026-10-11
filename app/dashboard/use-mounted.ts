"use client";

import { useSyncExternalStore } from "react";

// Never resubscribes: the value it reports differs between server and client but
// never changes afterwards, so there is nothing to subscribe to.
const noSubscribe = () => () => {};

// False on the server and through hydration, true from the first client render
// after it. Gate a `createPortal` on this whenever the component can be rendered
// already-open rather than only after a click: there is no document to portal
// into on the server. Branching on `typeof document` instead would swap the crash
// for a hydration error, because React reconciles a portal as part of the fiber
// tree, so server-null against client-portal is a mismatch. useSyncExternalStore
// is the primitive for exactly this — it hydrates against the server snapshot and
// re-renders with the client one, with no setState in an effect.
export function useMounted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}
