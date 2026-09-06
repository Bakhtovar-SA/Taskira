/**
 * HTTP-ошибка с кодом и человекочитаемой причиной.
 * Ответ клиенту нормализуется в { error: { code, reason } } (см. app.ts).
 *
 * Вынесено из middleware.ts отдельным модулем, чтобы сервисы (services/*)
 * могли бросать её без импорта middleware — иначе появляется цикл
 * middleware -> services/project -> middleware (Фаза 2 добавляет первую стрелку).
 */
export class ApiHttpError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    reason: string,
  ) {
    super(reason);
  }
}
