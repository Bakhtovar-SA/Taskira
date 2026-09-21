-- RESTART-SAFETY: лимит попыток входа по IP переезжает из памяти процесса в БД.
-- Счётчик в памяти (`Map` в routes/auth.ts) у каждого процесса свой: при втором экземпляре на той же БД
-- эффективный лимит — «10 × число процессов», а перезапуск обнуляет его. Блокировка по АККАУНТУ
-- (`users.failed_login_attempts`, `locked_until`) уже атомарна в БД; теперь так же устроен и лимит по IP.
--
-- Expand: новая таблица и индекс, ничего не удаляется и не меняется (docs/MIGRATIONS.md). Предыдущий образ на
-- расширенной схеме работает: он эту таблицу просто не читает.
-- Строки короткоживущие: старше окна лимита удаляются самим лимитером, остаточное — уборкой обслуживания.
CREATE TABLE IF NOT EXISTS login_attempts (
  id           bigserial PRIMARY KEY,
  ip           text        NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_at ON login_attempts (ip, attempted_at);
