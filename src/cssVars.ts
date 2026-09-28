/** ref-колбэк, который ставит CSS-переменные через CSSOM (ADR-0010): непрерывные значения из данных (позиции,
 *  ширины, цвета) не превращаются в новые правила `dynamic.css`, как было бы с `style={…}`. Статичное правило
 *  читает переменную: `left-[var(--x)]`. */
export const cssVars =
  (vars: Record<string, string | number>) =>
  (el: HTMLElement | null): void => {
    if (el) for (const k in vars) el.style.setProperty(k, typeof vars[k] === "number" ? `${vars[k]}px` : (vars[k] as string));
  };
