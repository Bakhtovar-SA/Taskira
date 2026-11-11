// Минимальный линтер клиента: только то, чего не ловят tsc и тесты, — правила React-хуков.
// Стиль и неиспользуемые имена проверяет tsc (`noUnusedLocals`), сюда их не добавляем.
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  { ignores: ["dist/**", "server/**", "node_modules/**", "docs/**", "public/**", "e2e/**", "scripts/**", "test-results/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "react-hooks": reactHooks },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      // Нарушений нет; новое роняет `npm run lint`.
      "react-hooks/rules-of-hooks": "error",
      // 113 существующих срабатываний на момент включения: часть — осознанные приёмы (значение в ref, синхронизация
      // роутера), часть может быть настоящими ошибками. Пока предупреждение: править их скопом — менять поведение.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
