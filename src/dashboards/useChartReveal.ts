import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionReduced } from "../motion";

/** Navigation snapshots and offscreen widgets must not consume the entrance
 * before the user reaches the chart. CSS owns every animation frame. */
export function useChartReveal<T extends HTMLElement>(revision: string, measuredRef?: RefObject<T | null>): RefObject<T | null> {
  const ownRef = useRef<T>(null);
  const ref = measuredRef ?? ownRef;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = el.ownerDocument.documentElement;
    const doc = el.ownerDocument;
    let visible = typeof IntersectionObserver === "undefined";
    let disposed = false;
    let intersection: IntersectionObserver | undefined;
    let navigation: MutationObserver | undefined;
    const disconnect = () => {
      intersection?.disconnect();
      navigation?.disconnect();
      doc.removeEventListener("visibilitychange", start);
    };
    const start = () => {
      if (disposed) return;
      if (!motionReduced() && (!visible || doc.visibilityState === "hidden" || root.classList.contains("vt-nav"))) return;
      el.setAttribute("data-chart-motion", "ready");
      disconnect();
    };
    el.setAttribute("data-chart-motion", "waiting");
    if (!motionReduced()) {
      navigation = new MutationObserver(start);
      navigation.observe(root, { attributes: true, attributeFilter: ["class", "data-motion"] });
      doc.addEventListener("visibilitychange", start);
      if (typeof IntersectionObserver !== "undefined") {
        intersection = new IntersectionObserver(entries => {
          visible = entries.some(entry => entry.isIntersecting);
          start();
        });
        intersection.observe(el);
      }
    }
    start();
    return () => {
      disposed = true;
      disconnect();
      el.removeAttribute("data-chart-motion");
    };
  }, [revision, ref]);
  return ref;
}
