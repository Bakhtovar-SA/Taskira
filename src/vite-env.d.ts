/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API. Пусто → origin текущей страницы (nginx proxy /api). */
  readonly VITE_API_URL?: string;
  /** SemVer релиза; dev при локальной сборке. */
  readonly VITE_APP_VERSION?: string;
}
