import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DependencyList,
} from "react";
import { useT } from "../i18n";
import { apiErrorText } from "../i18n/apiErrors";

export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList,
) {
  const { lang, t } = useT();
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    void load(ctl.signal)
      .then((r) => {
        if (!ctl.signal.aborted) setData(r);
      })
      .catch((e) => {
        if (!ctl.signal.aborted)
          setError(apiErrorText(e, lang, t, t("toast.error")));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [...deps, version]);
  return { data, setData, error, loading, reload };
}
export function useAction() {
  const { lang, t } = useT();
  const active = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const run = async <T>(action: () => Promise<T>, done?: (r: T) => void) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await action();
      if (active.current) done?.(r);
    } catch (e) {
      if (active.current) setError(apiErrorText(e, lang, t, t("toast.error")));
    } finally {
      locked.current = false;
      if (active.current) setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError(null) };
}
