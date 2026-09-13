import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Тесты клиента. До этого их не было вовсе: при ~7000 строк, из которых 1500 —
 * стор с оптимистичными обновлениями и разветвлённой загрузкой, единственной
 * проверкой была компиляция типов (аудит DEBT-02).
 *
 * Начинаем с чистых функций — там максимальная плотность логики на строку и
 * не нужен DOM: права, валидация, хелперы стора, формат дат. Компонентные
 * тесты (jsdom уже подключён) добавляются по мере необходимости.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: false,
    restoreMocks: true,
  },
});
