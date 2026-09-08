import { useState } from "react";
import { DEFAULT_WORKFLOW } from "../seed";
import { ACCESS_ROLES, PERMISSIONS, ROLE_ORDER, roleHas, roleMeta } from "../permissions";
import { ISSUE_TYPES, PRIORITIES, PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { IcBook, PriorityIcon, TypeIcon } from "../icons";
import { Kbd, RoleBadge, catColor } from "../ui";

const SECTIONS = [
  { id: "overview", label: "Обзор системы" },
  { id: "roles", label: "Роли и права" },
  { id: "workflow", label: "Workflow" },
  { id: "issues", label: "Типы и приоритеты" },
  { id: "list", label: "Список задач" },
  { id: "hotkeys", label: "Горячие клавиши" },
  { id: "model", label: "Модель данных" },
  { id: "storage", label: "Хранение и сессия" },
];

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-disp mb-1 mt-8 text-[15px] font-bold tracking-tight text-ink first:mt-0">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-[13px] leading-relaxed text-sub">{children}</p>;
const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-linesoft px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-accentdeep">{children}</code>
);

export default function DocsView() {
  const [active, setActive] = useState("overview");
  const go = (id: string) => {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] min-[1536px]:max-w-[1320px] min-[1920px]:max-w-[1600px] px-6 py-5">
        <div className="anim-fadeup flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar text-white"><IcBook size={18} /></span>
          <div>
            <h1 className="font-disp text-[17px] font-bold tracking-tight text-ink">Документация Taskira</h1>
            <p className="mt-0.5 text-[11.5px] text-faint">Полный справочник по системе: роли, workflow, модель данных · всегда актуален, так как генерируется из кода</p>
          </div>
        </div>

        <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr]">
          {/* навигация */}
          <nav className="top-5 h-fit rounded-xl border border-line bg-panel p-2 shadow-[0_1px_3px_rgba(20,35,64,0.05)] lg:sticky">
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                onClick={() => go(s.id)}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[12.5px] font-medium transition-colors ${active === s.id ? "bg-accentsoft font-semibold text-accent" : "text-sub hover:bg-canvas hover:text-ink"}`}
              >
                <span className={`font-mono text-[10px] font-bold ${active === s.id ? "text-accent" : "text-faint"}`}>{String(i + 1).padStart(2, "0")}</span>
                {s.label}
              </button>
            ))}
          </nav>

          {/* контент */}
          <div className="min-w-0 pb-10">
            <section id="doc-overview" className="anim-fadeup rounded-xl border border-line bg-panel p-5 shadow-[0_1px_3px_rgba(20,35,64,0.05)]">
              <H>1 · Обзор системы</H>
              <P>
                <b className="text-ink">Taskira</b> — корпоративный трекер задач: канбан-доска, список задач, таймлайн направлений,
                настраиваемый workflow, вложения, уведомления и ролевая модель доступа. Вход по паролю или через LDAP/AD;
                данные хранятся в PostgreSQL на сервере, в браузере — только токен сессии.
              </P>
              <P>Разделы приложения:</P>
              <ul className="mt-2 space-y-1.5 text-[13px] text-sub">
                <li>• <b className="text-ink">Доска</b> — колонки по статусам workflow, drag&drop с проверкой переходов и прав, быстрое создание, фильтры.</li>
                <li>• <b className="text-ink">Список задач</b> — плоский перечень всех задач проекта с фильтрами и сортировкой.</li>
                <li>• <b className="text-ink">Таймлайн</b> — дорожная карта направлений с прогрессом и линией «сегодня».</li>
                <li>• <b className="text-ink">Рабочий процесс</b> — граф статусов и переходов; редактируется администратором.</li>
                <li>• <b className="text-ink">Права доступа</b> — матрица разрешений и смена пользователя для проверки ролей.</li>
                <li>• <b className="text-ink">Документация</b> — этот раздел.</li>
              </ul>
              <P>
                Архитектурно приложение разделено на слои: <Code>types</Code> (доменная модель) → <Code>permissions</Code> (политика доступа) →{" "}
                <Code>store</Code> (состояние и мутации с проверками) → <Code>components</Code> (представление). Компоненты не меняют данные напрямую —
                только через действия store, поэтому обойти права через интерфейс невозможно.
              </P>
            </section>

            <section id="doc-roles" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "40ms" }}>
              <H>2 · Роли и права доступа</H>
              <P>
                Двухуровневая модель: <b className="text-ink">ролевой уровень</b> (матрица «разрешение × роль») и{" "}
                <b className="text-ink">уровень задачи</b> (сотрудник редактирует только свои задачи — где он исполнитель или автор).
                Проверки выполняются в двух местах: UI блокирует недоступные элементы, а сервер отклоняет запрещённые запросы —
                клиентская проверка нужна лишь для мгновенной обратной связи.
              </P>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {ACCESS_ROLES.map((r) => (
                  <div key={r.id} className="rounded-lg border border-linesoft bg-canvas/50 p-3">
                    <RoleBadge role={r.id} size="sm" />
                    <p className="mt-2 text-[12px] leading-relaxed text-sub">{r.desc}</p>
                  </div>
                ))}
              </div>
              <table className="mt-4 w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="px-2 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-faint">Разрешение</th>
                    {ROLE_ORDER.map((r) => (
                      <th key={r} className="px-2 py-2 text-center text-[10px] font-bold uppercase tracking-wider" style={{ color: roleMeta(r).color }}>{roleMeta(r).short}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {PERMISSIONS.map((p) => (
                    <tr key={p.id} className="border-b border-linesoft last:border-0">
                      <td className="px-2 py-1.5 font-medium text-ink">{p.name}</td>
                      {ROLE_ORDER.map((r) => (
                        <td key={r} className="px-2 py-1.5 text-center">
                          {roleHas(r, p.id) ? <span className="font-bold text-ok">✓</span> : <span className="text-line2">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <P>
                Роль назначается <b className="text-ink">в рамках проекта</b>: один человек может быть менеджером в своём проекте
                и наблюдателем в чужом. У наблюдателя доска работает в режиме «только чтение», кнопка «Создать» заблокирована;
                сотрудник видит все задачи проекта, но редактирует лишь те, где он исполнитель или автор — заблокированные поля
                в карточке помечены замком с пояснением.
              </P>
            </section>

            <section id="doc-workflow" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "60ms" }}>
              <H>3 · Рабочий процесс (workflow)</H>
              <P>
                Workflow — ориентированный граф: вершины — статусы, рёбра — разрешённые переходы. Статусы принадлежат категориям,
                которые определяют цвет и семантику:
              </P>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {DEFAULT_WORKFLOW.statuses.map((s) => {
                  const c = catColor(s.category);
                  const out = DEFAULT_WORKFLOW.transitions.filter((t) => t.from === s.id).length;
                  const inc = DEFAULT_WORKFLOW.transitions.filter((t) => t.to === s.id).length;
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-linesoft bg-canvas/50 px-3 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.dot }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-ink">{s.name}</p>
                        <p className="font-mono text-[10px] text-faint">id: {s.id} · категория: {s.category}</p>
                      </div>
                      <span className="font-mono text-[10.5px] text-faint">{out} → / {inc} ←</span>
                    </div>
                  );
                })}
              </div>
              <P>
                Переходы по умолчанию: <Code>К выполнению → В работе → На ревью → Готово</Code>, возвраты <Code>В работе → К выполнению</Code>,{" "}
                <Code>На ревью → В работе</Code>, <Code>Готово → В работе</Code> (переоткрытие) и прямое <Code>К выполнению → Готово</Code>.
                Смена статуса любым способом (drag на доске, меню в карточке) валидируется схемой: запрещённые переходы отклоняются.
                Администратор меняет схему в разделе «Рабочий процесс» — изменения действуют сразу.
              </P>
            </section>

            <section id="doc-issues" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "80ms" }}>
              <H>4 · Типы задач и приоритеты</H>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TYPE_ORDER.map((t) => (
                  <div key={t} className="flex items-center gap-2.5 rounded-lg border border-linesoft bg-canvas/50 px-3 py-2">
                    <TypeIcon type={t} size={16} />
                    <span className="text-[13px] font-semibold text-ink">{ISSUE_TYPES[t].name}</span>
                    <span className="ml-auto font-mono text-[10px] text-faint">{t}</span>
                  </div>
                ))}
              </div>
              <P>
                <b className="text-ink">Направление</b> — не отдельная сущность, а обычная задача, на которую ссылаются другие
                (поле «Направление» в карточке). Как только на задачу сослались, она появляется в выпадающем списке направлений
                и на таймлайне — с цветом и прогрессом по дочерним задачам.
              </P>
              <P>
                <b className="text-ink">Связанные задачи</b> — в карточке можно отметить связь с другой задачей проекта:
                «связана с» (симметрично), «блокирует» / «заблокирована» (направленно).
              </P>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIORITY_ORDER.map((p) => (
                  <span key={p} className="flex items-center gap-2 rounded-lg border border-linesoft bg-canvas/50 px-3 py-1.5 text-[12.5px] font-medium text-ink">
                    <PriorityIcon p={p} size={14} /> {PRIORITIES[p].name}
                  </span>
                ))}
              </div>
              <P>
                Карточка задачи хранит: название, описание, статус, приоритет, исполнителя, автора, направление, метки, срок,
                связанные задачи, вложения, комментарии и полную историю изменений (кто и что сделал, с временными метками).
              </P>
            </section>

            <section id="doc-list" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "100ms" }}>
              <H>5 · Список задач</H>
              <P>
                <b className="text-ink">Список задач</b> — плоский перечень всех задач проекта без секций и планирования. Фильтры (статус,
                исполнитель, тип, текст, «просроченные») и сортировка (по приоритету, сроку, обновлению, ключу; по возрастанию/убыванию)
                применяются на клиенте.
              </P>
              <P>
                Спринтов и scrum-церемоний в системе нет — поток задач ведётся через доску и этот список.
              </P>
            </section>

            <section id="doc-hotkeys" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "120ms" }}>
              <H>6 · Горячие клавиши</H>
              <table className="mt-2 w-full max-w-[460px] border-collapse text-[13px]">
                <tbody>
                  {[
                    ["Поиск по задачам", "/"],
                    ["Создать задачу", "C"],
                    ["Разделы: доска…мои подключения", "1 – 8"],
                    ["Закрыть окно / отмена", "Esc"],
                    ["Отправить комментарий", "Ctrl + Enter"],
                  ].map(([k, v]) => (
                    <tr key={k} className="border-b border-linesoft last:border-0">
                      <td className="py-2 text-sub">{k}</td>
                      <td className="py-2 text-right"><Kbd>{v}</Kbd></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section id="doc-model" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "140ms" }}>
              <H>7 · Модель данных</H>
              <P>Сущности и связи (описаны в <Code>src/types.ts</Code>):</P>
              <table className="mt-3 w-full border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left">
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-faint">Сущность</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-faint">Ключевые поля</th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-faint">Связи</th>
                  </tr>
                </thead>
                <tbody className="align-top">
                  {[
                    ["Project", "key, name, description", "корневая сущность"],
                    ["User", "id, name, role (должность), globalRole (admin | member)", "исполнитель/автор задач"],
                    ["ProjectMember", "projectId, userId, role (manager | employee | viewer)", "роль пользователя в конкретном проекте"],
                    ["Issue", "key (CORP-N), type, status, priority, assignee, reporter, dueDate, labels, links[], comments[], activity[]", "→ User, → Направление (epicId), → Status"],
                    ["IssueLink", "issueId, linkedIssueId, type (relates | blocks)", "связь между двумя задачами проекта"],
                    ["Направление", "Issue, на которую ссылаются через epicId; color, tStart/tSpan", "родитель для задач, элемент таймлайна"],
                    ["Workflow", "statuses[], transitions[]", "Status: id, name, category; Transition: from → to"],
                  ].map(([e, f, r]) => (
                    <tr key={e} className="border-b border-linesoft last:border-0">
                      <td className="px-2 py-2 font-mono text-[11px] font-bold text-accent">{e}</td>
                      <td className="px-2 py-2 text-sub">{f}</td>
                      <td className="px-2 py-2 text-faint">{r}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <P>
                Политика доступа вынесена в <Code>src/permissions.ts</Code>: матрица <Code>MATRIX</Code> (разрешение → роли),
                <Code>resolveRole(globalRole, projectRole)</Code> — эффективная роль (глобальный админ → <Code>admin</Code>,
                иначе роль участника проекта), функции <Code>can()</Code> / <Code>denialReason()</Code>.
                Store (<Code>src/store.tsx</Code>) оборачивает каждую мутацию в <Code>requirePerm()</Code>; сервер проверяет повторно.
              </P>
            </section>

            <section id="doc-storage" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "160ms" }}>
              <H>8 · Хранение и сессия</H>
              <P>
                Данные приходят с API (<Code>src/api/</Code>): bootstrap <Code>GET /api/projects/:id</Code> отдаёт проект, участников,
                состав (<Code>members</Code>) и workflow; задачи — <Code>GET /api/projects/:id/issues</Code>. Роль текущего пользователя
                store считает из <Code>globalRole</Code> и <Code>members</Code>; сервер проверяет её повторно на каждом запросе.
              </P>
              <P>
                В <Code>localStorage</Code> — только токен сессии (<Code>taskira.token</Code>) и оформление (тема и фон,{" "}
                <Code>taskira.theme</Code> / <Code>taskira.bg</Code>). Выход из аккаунта очищает токен; остальное состояние всегда приходит с сервера.
              </P>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
