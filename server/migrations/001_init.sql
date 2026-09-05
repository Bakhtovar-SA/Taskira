-- ============================================================
-- Taskira. Миграция 001: базовая схема PostgreSQL.
-- Применение: psql "$DATABASE_URL" -f 001_init.sql
-- Данные (проект, статусы workflow, первый админ) создаёт
-- seed-скрипт сервера (Этап 3): npm run seed --prefix server
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Пользователи. access_role — глобальная роль доступа (матрица прав на сервере).
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL UNIQUE,
  password_hash text NOT NULL,                    -- bcrypt, никогда не храним открытые пароли
  name          text NOT NULL,
  initials      text NOT NULL DEFAULT '',
  color         text NOT NULL DEFAULT '#0B5FD9',
  job_role      text NOT NULL DEFAULT '',          -- должность: «бэкенд», «QA»…
  access_role   text NOT NULL DEFAULT 'developer'
                CHECK (access_role IN ('admin', 'manager', 'developer', 'viewer')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,                -- «ATL»
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Статусы workflow (колонки доски). sid — стабильный идентификатор ('todo', 'inprogress'…).
CREATE TABLE workflow_statuses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sid        text NOT NULL,
  name       text NOT NULL,
  category   text NOT NULL CHECK (category IN ('todo', 'inprogress', 'done')),
  position   int  NOT NULL DEFAULT 0,
  UNIQUE (project_id, sid)
);

-- Разрешённые переходы. Сервер проверяет каждый transition по этой таблице.
CREATE TABLE workflow_transitions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_status_id uuid NOT NULL REFERENCES workflow_statuses(id) ON DELETE CASCADE,
  to_status_id   uuid NOT NULL REFERENCES workflow_statuses(id) ON DELETE CASCADE,
  UNIQUE (project_id, from_status_id, to_status_id),
  CHECK (from_status_id <> to_status_id)
);

CREATE TABLE sprints (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL,
  goal       text NOT NULL DEFAULT '' CHECK (char_length(goal) <= 200),
  status     text NOT NULL DEFAULT 'future'
             CHECK (status IN ('future', 'active', 'completed')),
  start_date date,
  end_date   date,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Задачи. rank float8 — дробный ранг порядка в колонке
-- (вставка между соседями = среднее; при сближении < 1e-9 — rebalance колонки).
CREATE TABLE issues (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  num         int  NOT NULL,                       -- номер внутри проекта
  key         text NOT NULL UNIQUE,                -- «ATL-42», выставляется приложением
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 250),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
  type_id     text NOT NULL CHECK (type_id IN ('story', 'task', 'bug', 'epic')),
  status_id   uuid NOT NULL REFERENCES workflow_statuses(id),
  priority_id text NOT NULL CHECK (priority_id IN ('highest', 'high', 'medium', 'low', 'lowest')),
  assignee_id uuid REFERENCES users(id)   ON DELETE SET NULL,
  reporter_id uuid NOT NULL REFERENCES users(id),
  epic_id     uuid REFERENCES issues(id)  ON DELETE SET NULL,
  color       text,                                -- цвет эпика
  t_start     int,                                 -- таймлайн: неделя начала (0..N)
  t_span      int,                                 -- таймлайн: длительность в неделях
  points      int  CHECK (points BETWEEN 0 AND 100),
  sprint_id   uuid REFERENCES sprints(id) ON DELETE SET NULL,
  labels      text[] NOT NULL DEFAULT '{}',
  rank        float8 NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, num)
);

CREATE INDEX idx_issues_project_status ON issues (project_id, status_id, rank);
CREATE INDEX idx_issues_sprint         ON issues (sprint_id);
CREATE INDEX idx_issues_epic           ON issues (epic_id);
CREATE INDEX idx_issues_assignee       ON issues (assignee_id);

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_issue ON comments (issue_id, created_at);

-- История изменений задачи («кто, что, когда» по каждой задаче)
CREATE TABLE activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id   uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  actor_id   uuid NOT NULL REFERENCES users(id),
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_issue ON activity (issue_id, created_at);

-- Аудит-лог уровня системы: аутентификация, смена ролей, правка workflow…
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  action     text NOT NULL,                        -- 'auth.login', 'user.role.change', 'workflow.transition.add'…
  entity     text NOT NULL,                        -- 'auth' | 'issue' | 'sprint' | 'workflow' | 'user'
  entity_id  uuid,
  details    jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_actor   ON audit_log (actor_id);
