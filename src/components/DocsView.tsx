import { useState } from "react";
import { DEFAULT_WORKFLOW } from "../seed";
import { ACCESS_ROLES, PERMISSIONS, ROLE_ORDER, roleHas, roleMeta } from "../permissions";
import { PRIORITY_ORDER, TYPE_ORDER } from "../types";
import { IcBook, PriorityIcon, TypeIcon } from "../icons";
import { Kbd, RoleBadge, catColor } from "../ui";
import { useT } from "../i18n";
import { workflowStatusName } from "../workflowStatus";

const SECTIONS = [
  { id: "overview", label: "Обзор системы" },
  { id: "roles", label: "Роли и права" },
  { id: "workflow", label: "Workflow" },
  { id: "issues", label: "Карточка задачи" },
  { id: "list", label: "Список задач" },
  { id: "sprints", label: "Спринты" },
  { id: "notifications", label: "Уведомления" },
  { id: "attachments", label: "Вложения" },
  { id: "departments", label: "Департаменты и LDAP" },
  { id: "reports", label: "Отчёты" },
  { id: "home", label: "Главный экран" },
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

const EN_SECTIONS = [
  ["overview", "System overview"], ["roles", "Roles and permissions"], ["workflow", "Workflow"],
  ["issues", "Issue details"], ["list", "Issue list"], ["sprints", "Sprints"],
  ["notifications", "Notifications"], ["attachments", "Attachments"], ["departments", "Departments and LDAP"],
  ["reports", "Reports"], ["home", "Home"], ["hotkeys", "Keyboard shortcuts"],
  ["model", "Data model"], ["storage", "Storage and sessions"],
] as const;

function DocsEnglish() {
  const [active, setActive] = useState("overview");
  const go = (id: string) => {
    setActive(id);
    document.getElementById(`doc-en-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const sections: { id: string; title: string; body: React.ReactNode }[] = [
    { id: "overview", title: "1 · System overview", body: <>Taskira is a project-scoped issue tracker. The board, backlog, timeline, reports, workflow, and access pages are views over the same server data. Everyone with project access can view every issue; mutations are enforced separately by role.</> },
    { id: "roles", title: "2 · Roles and permissions", body: <>Resource administrators manage everything. Project managers can create, edit, move, and delete any issue. Employees can create and comment, but may edit or move only issues where they are the reporter or an assignee. Viewers have read-only access to all issues. The server is the source of truth for every permission check.</> },
    { id: "workflow", title: "3 · Workflow", body: <>Statuses belong to a project and transitions define allowed moves. The board, issue details, and API all apply the same transition schema. Only resource administrators can edit or reset it.</> },
    { id: "issues", title: "4 · Issue details", body: <>An issue contains a title, description, type, priority, status, due date, complexity, labels, assignees, a direction, optional parent, checklist, links, custom fields, attachments, comments, and activity. User-entered content is displayed exactly as written and is never translated.</> },
    { id: "list", title: "5 · Issue list", body: <>The backlog lists all active issues and can optionally include closed ones. Filters cover text, status, assignee, type, and overdue state. Sorting is available by priority, due date, update time, or key. Trello JSON exports can be imported here.</> },
    { id: "sprints", title: "6 · Sprints", body: <>Sprints are an optional project module. Managers and administrators can create, start, and complete sprints and move issues between a sprint and the backlog. Completing a sprint returns unfinished issues to the backlog.</> },
    { id: "notifications", title: "7 · Notifications", body: <>Notifications cover assignments, comments, mentions, status changes, issue invitations, and project membership. Each user can choose instant email or a daily digest and can automatically watch issues they create.</> },
    { id: "attachments", title: "8 · Attachments", body: <>Attachments are stored outside the database and downloaded through an authenticated API. File size and type are validated. Users who may comment can upload files; owners and users with delete permission can remove them.</> },
    { id: "departments", title: "9 · Departments and LDAP", body: <>Departments group projects. Shared projects are visible across departments. In LDAP mode, department membership can be synchronized from configured directory groups; manually added memberships remain manageable in Taskira.</> },
    { id: "reports", title: "10 · Reports", body: <>Reports summarize created, closed, open, and overdue issues and lead time for a selected date range. Results can be grouped by project, assignee, type, or priority and exported as CSV.</> },
    { id: "home", title: "11 · Home", body: <>Home shows assigned and overdue work, available projects, and recent activity. Selecting a project loads its data and opens the last relevant working view.</> },
    { id: "hotkeys", title: "12 · Keyboard shortcuts", body: <><Code>C</Code> opens issue creation, number keys switch sections, and <Code>Escape</Code> closes dialogs. In editable fields, standard typing shortcuts keep their browser behavior.</> },
    { id: "model", title: "13 · Data model", body: <>Core entities are users, departments, projects, project members, issues, assignees, collaborators, statuses, transitions, comments, activity, checklist items, issue links, templates, custom fields, sprints, notifications, and attachments. Foreign keys and server-side permission checks protect cross-project boundaries.</> },
    { id: "storage", title: "14 · Storage and sessions", body: <>PostgreSQL stores application data; configured object storage stores attachments and avatars. The signed session is sent in an HttpOnly, SameSite cookie and checked against a server-side session version, so logout and role changes revoke older sessions. Local storage contains interface preferences only.</> },
  ];
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] px-6 py-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar text-white"><IcBook size={18} /></span>
          <div><h1 className="font-disp text-[17px] font-bold text-ink">Taskira documentation</h1><p className="mt-0.5 text-[11.5px] text-faint">A complete guide to the current product behavior and access model</p></div>
        </div>
        <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr]">
          <nav className="top-5 h-fit rounded-xl border border-line bg-panel p-2 lg:sticky">
            {EN_SECTIONS.map(([id, label]) => <button key={id} onClick={() => go(id)} className={`flex w-full rounded-md px-3 py-2 text-left text-[12.5px] ${active === id ? "bg-accentsoft font-semibold text-accent" : "text-sub hover:bg-canvas"}`}>{label}</button>)}
          </nav>
          <div>{sections.map((s) => <section key={s.id} id={`doc-en-${s.id}`} className="mb-4 scroll-mt-5 rounded-xl border border-line bg-panel p-5"><H>{s.title}</H><P>{s.body}</P></section>)}</div>
        </div>
      </div>
    </div>
  );
}

export default function DocsView() {
  const { t, lang } = useT();
  const [active, setActive] = useState("overview");
  const go = (id: string) => {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (lang === "en") return <DocsEnglish />;

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
                данные хранятся в PostgreSQL на сервере, а сессия передаётся защищённой HttpOnly-cookie.
              </P>
              <P>Разделы приложения:</P>
              <ul className="mt-2 space-y-1.5 text-[13px] text-sub">
                <li>• <b className="text-ink">Доска</b> — колонки по статусам workflow, drag&drop с проверкой переходов и прав, быстрое создание, фильтры.</li>
                <li>• <b className="text-ink">Список задач</b> — плоский перечень всех задач проекта с фильтрами и сортировкой.</li>
                <li>• <b className="text-ink">Спринты</b> — опциональный модуль (см. раздел 6); включается администратором отдельно на каждый проект.</li>
                <li>• <b className="text-ink">Таймлайн</b> — дорожная карта направлений с прогрессом и линией «сегодня».</li>
                <li>• <b className="text-ink">Отчёты</b> — агрегаты по закрытым/созданным задачам и выгрузка в CSV (см. раздел 10).</li>
                <li>• <b className="text-ink">Рабочий процесс</b> — граф статусов и переходов; редактируется администратором.</li>
                <li>• <b className="text-ink">Права доступа</b> — матрица разрешений и смена пользователя для проверки ролей.</li>
                <li>• <b className="text-ink">Департаменты</b> — только у глобального администратора: отделы, проекты, LDAP-группы (см. раздел 9).</li>
                <li>• <b className="text-ink">Документация</b> — этот раздел.</li>
              </ul>
              <P>
                Если пользователю видно больше одного проекта, вход начинается с <b className="text-ink">главного экрана</b> (раздел 11) —
                оттуда переходят в конкретный проект; при единственном видимом проекте он открывается сразу.
              </P>
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
                  const out = DEFAULT_WORKFLOW.transitions.filter((tr) => tr.from === s.id).length;
                  const inc = DEFAULT_WORKFLOW.transitions.filter((tr) => tr.to === s.id).length;
                  return (
                    <div key={s.id} className="flex items-center gap-3 rounded-lg border border-linesoft bg-canvas/50 px-3 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: c.dot }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-bold text-ink">{workflowStatusName(s, t)}</p>
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
              <H>4 · Карточка задачи</H>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TYPE_ORDER.map((ty) => (
                  <div key={ty} className="flex items-center gap-2.5 rounded-lg border border-linesoft bg-canvas/50 px-3 py-2">
                    <TypeIcon type={ty} size={16} />
                    <span className="text-[13px] font-semibold text-ink">{t(`issueType.${ty}`)}</span>
                    <span className="ml-auto font-mono text-[10px] text-faint">{ty}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIORITY_ORDER.map((p) => (
                  <span key={p} className="flex items-center gap-2 rounded-lg border border-linesoft bg-canvas/50 px-3 py-1.5 text-[12.5px] font-medium text-ink">
                    <PriorityIcon p={p} size={14} /> {t(`priority.${p}`)}
                  </span>
                ))}
              </div>
              <P>
                <b className="text-ink">Исполнители</b> — на задаче может быть один, несколько или ни одного исполнителя
                (плоский список без «главного»); любой из них — как и автор задачи — может редактировать задачу, даже если
                его роль сотрудник. Это не то же самое, что <b className="text-ink">приглашённые участники</b>: приглашённый
                видит только эту задачу и её комментарии, не становится исполнителем и не получает членства в проекте — удобно,
                чтобы подключить человека из другого отдела для консультации, не открывая ему весь проект.
              </P>
              <P>
                <b className="text-ink">Сложность</b> — необязательная трёхзначная шкала (простая / средняя / сложная), не связанная
                со Scrum-очками. <b className="text-ink">Направление</b> — не отдельная сущность, а обычная задача, на которую
                ссылаются другие (поле «Направление» в карточке). Как только на задачу сослались, она появляется в выпадающем
                списке направлений и на таймлайне — с цветом и прогрессом по дочерним задачам.
              </P>
              <P>
                <b className="text-ink">Подзадачи</b> — ровно два уровня вложенности (подзадачу нельзя сделать подзадачей
                подзадачи); кнопка «+ подзадача» на карточке родителя предзаполняет создание. <b className="text-ink">Чек-лист</b> —
                простой список пунктов с отметкой «сделано», до 50 на задачу. <b className="text-ink">Пользовательские поля</b> —
                администратор определяет на уровне проекта (текст, число, список, чекбокс, дата) в разделе «Рабочий процесс»;
                значения задаются на самой карточке.
              </P>
              <P>
                <b className="text-ink">Связанные задачи</b> — в карточке можно отметить связь с другой задачей проекта:
                «связана с» (симметрично), «блокирует» / «заблокирована» (направленно). <b className="text-ink">Шаблоны задач</b> —
                администратор заводит в проекте набор заготовок (тип, приоритет, заголовок, описание); при создании задачи шаблон
                просто предзаполняет форму, дальнейшая связь с ним не сохраняется.
              </P>
              <P>
                Карточка задачи хранит: название, описание, статус, приоритет, сложность, исполнителей, автора, направление,
                родителя/подзадачи, метки, срок, связанные задачи, чек-лист, значения пользовательских полей, вложения (раздел 8),
                комментарии и полную историю изменений (кто и что сделал, с временными метками).
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
                Спринты — отдельный опциональный модуль (раздел 6), не часть этого списка: если он выключен в проекте,
                поток задач ведётся только через доску и «Список задач».
              </P>
            </section>

            <section id="doc-sprints" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "120ms" }}>
              <H>6 · Спринты (опциональный модуль)</H>
              <P>
                Спринты выключены по умолчанию — администратор включает их отдельно на каждый проект («общий» флаг не даёт
                этого сделать сразу для всех). У выключенного модуля не только скрыта вкладка: сами роуты API отвечают
                «не найдено» независимо от роли, так что отключение действительно прячет данные, а не только кнопку.
              </P>
              <P>
                Спринт проходит три состояния: <Code>future</Code> (будущий) → <Code>active</Code> (активный) →{" "}
                <Code>completed</Code> (завершён). В проекте одновременно может быть только один активный спринт.
                Завершение спринта переносит его незакрытые задачи обратно в бэклог; закрытые остаются привязаны к нему —
                автоматического переноса в следующий спринт нет. Управляют спринтами (создание, старт, завершение,
                перенос задачи в спринт/из него) администратор и менеджер проекта; остальные роли только видят список.
              </P>
            </section>

            <section id="doc-notifications" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "140ms" }}>
              <H>7 · Уведомления</H>
              <P>
                Колокольчик в шапке показывает непрочитанные уведомления в реальном времени (по WebSocket — сокет лишь
                сигналит «обновись», сама лента догружается обычным запросом). Получатели зависят от события: смену статуса и
                новый комментарий видят наблюдатели задачи, её исполнители, автор и приглашённые участники; назначение
                исполнителя — только новый исполнитель; упоминание <Code>@логин</Code> в описании или комментарии — упомянутый,
                если ему видна задача. Автор события уведомление о своём же действии не получает.
              </P>
              <P>
                Email-рассылка — отдельный, по умолчанию выключенный канал; когда включена администратором сервера, письмо
                уходит только тем, у кого есть адрес почты и кто не отключил email в своих настройках уведомлений.
              </P>
            </section>

            <section id="doc-attachments" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "160ms" }}>
              <H>8 · Вложения</H>
              <P>
                Файлы прикрепляются прямо к карточке задачи (до 50 штук, каждый до 25&nbsp;МБ — сервер может настроить другие
                пределы). Прикрепляет любой, у кого есть право комментировать задачу; убрать вложение может тот, кто его
                загрузил, либо тот, у кого есть право удалять задачи. Хранилище — локальный диск сервера или S3-совместимое
                хранилище, в зависимости от конфигурации; для карточки это не видно, скачивание и удаление работают одинаково.
              </P>
            </section>

            <section id="doc-departments" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "180ms" }}>
              <H>9 · Департаменты, видимость проектов и LDAP</H>
              <P>
                <b className="text-ink">Отдел</b> — группа проектов, а не отдельная область данных: проект по умолчанию виден
                участникам своего отдела, а с флагом «общий» — видят все, независимо от отдела. Явное членство в конкретном
                проекте (роль менеджер/сотрудник/наблюдатель) всегда даёт доступ вне зависимости от отдела.
              </P>
              <P>
                Вход возможен по паролю (локальные учётки) или через LDAP/AD — режим выбирает администратор сервера для всего
                приложения сразу. В режиме LDAP членство в отделе обычно приходит из групп директории: у отдела задаётся DN
                группы, и при входе/пересинхронизации сервер сверяет группы пользователя с этой настройкой. Если у отдела нет
                привязанной LDAP-группы — или человек ещё не входил ни в одну подходящую группу — администратор может добавить
                его в отдел вручную, в том же разделе «Департаменты»; такое членство ручным и остаётся, пересинхронизация LDAP
                его не трогает (и не убирает — снять вручную добавленного может только сам администратор, не автоматика).
              </P>
            </section>

            <section id="doc-reports" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "200ms" }}>
              <H>10 · Отчёты</H>
              <P>
                Отчёт не завязан на один проект — он строится по всем проектам, видимым текущему пользователю (то же правило
                видимости, что в общем списке проектов), с опциональным фильтром по проекту или отделу и периодом дат. Сводка:
                сколько закрыто/создано за период, сколько сейчас открыто и просрочено, среднее и медианное время жизни задачи
                (от создания до закрытия) и недельный тренд закрытий. Разбивка — по проекту, исполнителю, типу или приоритету;
                у задачи с несколькими исполнителями разбивка «по исполнителю» засчитывает её каждому из них, поэтому сумма по
                строкам может быть больше общего счётчика «закрыто». Построчная выгрузка (CSV) — отдельно, с тем же периодом.
              </P>
            </section>

            <section id="doc-home" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "220ms" }}>
              <H>11 · Главный экран и переключение проектов</H>
              <P>
                Появляется, когда пользователю видно два и более проекта: сводка «мои задачи» (открытые задачи, где он
                исполнитель, по всем видимым проектам), просроченные, и список проектов с недавними/избранными наверху.
                Переключатель проектов в шапке ищет по названию и ключу, а не только листает список — на организацию с
                десятками проектов пролистывать было бы неудобно. Отдельно — кросс-проектный поиск задач (значок поиска),
                который находит задачу по названию или ключу в любом видимом проекте, не открывая его.
              </P>
            </section>

            <section id="doc-hotkeys" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "240ms" }}>
              <H>12 · Горячие клавиши</H>
              <table className="mt-2 w-full max-w-[460px] border-collapse text-[13px]">
                <tbody>
                  {[
                    ["Поиск по задачам", "/"],
                    ["Создать задачу", "C"],
                    ["Разделы: доска…документация", "1 – 9"],
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

            <section id="doc-model" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "260ms" }}>
              <H>13 · Модель данных</H>
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
                    ["Department", "id, name, ldapGroupDn", "группа проектов; членство — DepartmentMember"],
                    ["DepartmentMember", "departmentId, userId, source (ldap | manual)", "из LDAP-группы или добавлено вручную"],
                    ["Project", "key, name, description, isShared, sprintsEnabled", "принадлежит Department"],
                    ["User", "id, name, role (должность), globalRole (admin | member)", "исполнитель/автор задач"],
                    ["ProjectMember", "projectId, userId, role (manager | employee | viewer)", "роль пользователя в конкретном проекте"],
                    ["Issue", "key (CORP-N), type, status, priority, complexity, assigneeIds[], reporter, dueDate, labels, links[], comments[], activity[]", "→ User[] (исполнители), → Направление (epicId), → Status, → Issue (parentId)"],
                    ["IssueAssignee", "issueId, userId", "плоский список исполнителей задачи — их может быть 0, 1 или несколько"],
                    ["Collaborator", "issueId, userId", "приглашённый к одной задаче — не исполнитель и не участник проекта"],
                    ["IssueLink", "issueId, linkedIssueId, type (relates | blocks)", "связь между двумя задачами проекта"],
                    ["ChecklistItem", "issueId, text, done, position", "пункт чек-листа на задаче"],
                    ["CustomField / CustomFieldValue", "projectId, name, type; issueId, fieldId, value", "поле определяется на проекте, значение — на задаче"],
                    ["IssueTemplate", "projectId, name, typeId, priorityId, title, description", "заготовка для формы создания, связь не сохраняется"],
                    ["Sprint", "projectId, name, goal, status (future | active | completed)", "опциональный модуль; issues.sprintId"],
                    ["Notification", "userId, type, issueId, emailState", "уведомление в ленте / отправленное на почту"],
                    ["Attachment", "issueId, filename, size, storageKey", "файл, прикреплённый к задаче"],
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

            <section id="doc-storage" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "280ms" }}>
              <H>14 · Хранение и сессия</H>
              <P>
                Данные приходят с API (<Code>src/api/</Code>): bootstrap <Code>GET /api/projects/:id</Code> отдаёт проект, участников,
                состав (<Code>members</Code>) и workflow; задачи — <Code>GET /api/projects/:id/issues</Code>. Роль текущего пользователя
                store считает из <Code>globalRole</Code> и <Code>members</Code>; сервер проверяет её повторно на каждом запросе.
              </P>
              <P>
                Сессия хранится в защищённой <Code>HttpOnly</Code>-cookie и недоступна JavaScript. В <Code>localStorage</Code> остаются только
                локальные настройки интерфейса: язык, выбранный проект, тема и фон. Выход из аккаунта отзывает сессию на сервере;
                рабочие данные всегда приходят через API.
              </P>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
