/** Подсказка, которая грузится отдельным чанком: с ней приходит @floating-ui/dom, а кнопки, аватары и поля стоят
 *  и на экранах из входного чанка (доска, вход). Пока модуль не пришёл, содержимое уже на месте — без подсказки. */
import { lazy, Suspense, type ReactElement, type ReactNode } from "react";

const Real = lazy(() => import("./Overlay").then((m) => ({ default: m.Tooltip })));

export function Tooltip({ label, kbd, children }: { label: ReactNode; kbd?: string; children: ReactElement }) {
  return (
    <Suspense fallback={children}>
      <Real label={label} kbd={kbd}>
        {children}
      </Real>
    </Suspense>
  );
}
