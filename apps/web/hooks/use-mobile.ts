import * as React from "react";

// Section 19: the sidebar becomes a drawer at 760px and below.
const MOBILE_BREAKPOINT = 761;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

// Reads the media query through useSyncExternalStore instead of setting state
// inside an effect; the server snapshot matches the previous `false` default.
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(MOBILE_QUERY).matches,
    () => false,
  );
}
