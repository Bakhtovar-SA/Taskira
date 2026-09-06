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
  { id: "sprints", label: "Спринты и бэклог" },
  { id: "hotkeys", label: "Горячие клавиши" },
  { id: "model", label: "Модель данных" },
  { id: "storage", label: "Хранение и сброс" },
];

const H = ({ children }: { children: React.ReactNode }) => (
  <h2 className="font-disp mb-1 mt-8 text-[15px] font-bold tracking-tight text-ink first:mt-0">{children}</h2>
);
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-2 text-[13px] leading-relaxed text-sub">{children}</p>;
const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-[#e8edf4] px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-[#0a4cb0]">{children}</code>
);

export default function DocsView() {
  const [active, setActive] = useState("overview");
  const go = (id: string) => {
    setActive(id);
    document.getElementById(`doc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1060px] px-6 py-5">
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
                <b className="text-ink">Taskira</b> — трекер задач в духе Jira: проект <Code>ATL «Атлас»</Code>, канбан-доска, бэклог со спринтами,
                таймлайн эпиков, настраиваемый workflow и ролевая модель доступа. Всё состояние живёт в браузере (localStorage),
                сервер не требуется.
              </P>
              <P>Разделы приложения:</P>
              <ul className="mt-2 space-y-1.5 text-[13px] text-sub">
                <li>• <b className="text-ink">Доска</b> — колонки по статусам workflow, drag&drop с проверкой переходов и прав, быстрое создание, фильтры.</li>
                <li>• <b className="text-ink">Бэклог</b> — планирование спринтов: активный, будущий и вне спринтов; перенос задач перетаскиванием.</li>
                <li>• <b className="text-ink">Таймлайн</b> — дорожная карта эпиков с прогрессом и линией «сегодня».</li>
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
                <b className="text-ink">уровень задачи</b> (разработчик редактирует только свои задачи — где он исполнитель или автор).
                Проверки выполняются в двух местах: UI блокирует недоступные элементы, а store отклоняет запрещённые мутации с тостом-пояснением.
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
                          {roleHas(r, p.id) ? <span className="font-bold text-ok">✓</span> : <span className="text-[#c3ccda]">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <P>
                Пример сценария: войдите как <b className="text-ink">Елена Волкова (Наблюдатель)</b> через меню пользователя — доска перейдёт в режим
                «только чтение», кнопка «Создать» заблокируется. Затем войдите как <b className="text-ink">Мария Ким (Разработчик)</b> и откройте чужую
                задачу — поля будут заблокированы, а свою (где она исполнитель) удастся отредактировать.
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
                <b className="text-ink">Эпик</b> — крупная инициатива: группирует дочерние задачи (поле «Эпик» в карточке), отображается на таймлайне
                с цветом и прогрессом. История, задача и бак — рабочие элементы, попадают на доску и в спринты.
              </P>
              <div className="mt-3 flex flex-wrap gap-2">
                {PRIORITY_ORDER.map((p) => (
                  <span key={p} className="flex items-center gap-2 rounded-lg border border-linesoft bg-canvas/50 px-3 py-1.5 text-[12.5px] font-medium text-ink">
                    <PriorityIcon p={p} size={14} /> {PRIORITIES[p].name}
                  </span>
                ))}
              </div>
              <P>
                Карточка задачи хранит: название, описание, статус, приоритет, исполнителя, автора, эпик, метки, оценку в story points,
                привязку к спринту, комментарии и полную историю изменений (кто и что сделал, с временными метками).
              </P>
            </section>

            <section id="doc-sprints" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "100ms" }}>
              <H>5 · Спринты и бэклог</H>
              <P>
                Жизненный цикл спринта: <b className="text-ink">future → active → completed</b>. Задачи планируются перетаскиванием между секциями
                в «Бэклоге» (право «Управление спринтами»). Старт активирует будущий спринт — его задачи появляются на доске.
              </P>
              <P>
                При завершении спринта все недозакрытые задачи автоматически возвращаются в бэклог (вне спринтов), а система создаёт следующий
                будущий спринт. У активного спринта есть цель, даты и прогресс «закрыто/всего».
              </P>
            </section>

            <section id="doc-hotkeys" className="anim-fadeup mt-4 rounded-xl border border-line bg-panel p-5" style={{ animationDelay: "120ms" }}>
              <H>6 · Горячие клавиши</H>
              <table className="mt-2 w-full max-w-[460px] border-collapse text-[13px]">
                <tbody>
                  {[
                    ["Поиск по задачам", "/"],
                    ["Создать задачу", "C"],
                    ["Разделы: доска…документация", "1 – 6"],
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
                    ["Issue", "key (ATL-N), type, status, priority, points, labels, comments[], activity[]", "→ User, → Epic, → Sprint, → Status"],
                    ["Epic", "Issue с typeId=epic, color, tStart/tSpan", "родитель для задач, элемент таймлайна"],
                    ["Sprint", "name, goal, status, startDate, endDate", "← Issue.sprintId"],
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
              <H>8 · Хранение и сброс</H>
              <P>
                Данные приходят с API (<Code>src/api/</Code>): bootstrap <Code>GET /api/project</Code> отдаёт проект, участников,
                состав (<Code>members</Code>) и workflow; задачи — <Code>GET /api/issues</Code>. В <Code>localStorage</Code> хранится
                только JWT (<Code>taskira.token</Code>). Роль текущего пользователя store считает из <Code>globalRole</Code> и{" "}
                <Code>members</Code>.
              </P>
              <P>
                Кнопка «Сбросить демо-данные» в сайдбаре очищает ключ и возвращает исходный проект: 22 задачи, 2 активных спринта, 3 эпика и полную
                историю активности. Сброс доступен любой роли — это инструмент демо-среды, а не рабочая мутация.
              </P>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
