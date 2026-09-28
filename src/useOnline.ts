/** Есть ли сеть (ТЗ 5.12 a: офлайн). `navigator.onLine` ложно-положителен (сеть есть, сервера нет), но ложно-
 *  отрицательным не бывает — для «нет связи» этого достаточно; недоступный сервер ловят сами запросы. */
import { useSyncExternalStore } from "react";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};

export const useOnline = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
