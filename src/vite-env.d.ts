/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Базовый URL API. Пусто → http://localhost:8080 (см. src/api/index.ts). */
  readonly VITE_API_URL?: string;
}
