/* Загрузка, сессия и навигация между проектами: `bootstrap`, `switchProject` (гонки — `switchSeqRef`), `goHome`,
 * `enterProject`, `logout`, список и открытие задачи (`refreshIssues`, `ensureAllIssues`, `refreshCollaborations`, `openIssue`) —
 * вынесено из store.tsx без изменений поведения (ТЗ 2.3, шаг 6). Поведение и гонки зафиксированы
 * store.bootNav.test.tsx, ДО выноса. Известная брешь (SEC-01: ответы после logout воскрешают данные) перенесена как есть. */
import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AssignedIssue, Collaboration, Data, Department, ProjectRole, ProjectSummary } from "../types";
import {
  ApiError,
  authApi,
  clearToken,
  commentsApi,
  departmentsApi,
  issuesApi,
  projectsApi,
  type CollaboratingItem,
} from "../api";
import {
  emptyData,
  listAllIssues,
  mapIssue,
  mapIssueTemplate,
  mapSprint,
  mapUser,
  readIssueHash,
  readLastProject,
  takeHomeIntro,
  upsertIssue,
  writeLastProject,
} from "./mappers";
import type { StoreCtx } from "./ctx";
import type { BootStatus, SoloState, UIState } from "./mappers";

export interface SessionDeps {
  setBootStatus: Dispatch<SetStateAction<BootStatus>>;
  setSolo: Dispatch<SetStateAction<SoloState | null>>;
  setAuthMode: Dispatch<SetStateAction<"local" | "ldap">>;
  setUi: Dispatch<SetStateAction<UIState>>;
  bumpIssues: () => void;
  refreshNotifications: () => Promise<void>;
  /** Эпоха сессии (SEC-01): растёт при logout и при 401; ответ запроса, начатого в прошлой эпохе, применять нельзя. */
  sessionEpochRef: MutableRefObject<number>;
}

export function useSessionActions(
  { setData, dataRef, pid, toast, handleApiError, local }: StoreCtx,
  { setBootStatus, setSolo, setAuthMode, setUi, bumpIssues, refreshNotifications, sessionEpochRef }: SessionDeps,
) {
  /** Грузит данные одного проекта (bootstrap + задачи) в объект Data. */
  const buildProjectData = useCallback(
    async (
      projectId: string,
      currentUserId: string,
      projects: ProjectSummary[],
      departments: Department[],
      collaborations: Collaboration[],
      favoriteProjectIds: string[],
    ): Promise<Data> => {
      const boot = await projectsApi.get(projectId);
      const members: Record<string, ProjectRole> = {};
      for (const m of boot.members) members[m.userId] = m.role;
      const users = boot.users.map((u) => mapUser(u, members));
      return {
        project: {
          id: boot.project.id,
          key: boot.project.key,
          name: boot.project.name,
          description: boot.project.description ?? "",
          departmentId: boot.project.departmentId,
          isShared: boot.project.isShared,
          sprintsEnabled: boot.project.sprintsEnabled,
        },
        projects,
        favoriteProjectIds,
        departments,
        currentProjectId: projectId,
        users,
        members,
        currentUserId,
        // Стор стартует пустым: задачи приходят наборами (Список/Доска/Timeline), точечными запросами
        // по id и — только для Sprints — по явному ensureAllIssues.
        issues: [],
        issuesComplete: false,
        assignedToMe: [],
        assignedTruncated: false,
        collaborations,
        notifications: [],
        unreadCount: 0,
        notifyPrefs: {},
        workflow: {
          statuses: boot.workflow.statuses.map((s) => ({ id: s.id, sid: s.sid, name: s.name, category: s.category })),
          transitions: boot.workflow.transitions.map((t) => ({ id: t.id, from: t.from, to: t.to })),
        },
        issueTemplates: boot.issueTemplates.map(mapIssueTemplate),
        customFields: boot.customFields,
        sprints: boot.sprints.map(mapSprint),
      };
    },
    [],
  );

  const bootstrap = useCallback(async () => {
    setBootStatus("loading");
    // SEC-01: если за время загрузки был logout (или сессия сброшена по 401), результат применять нельзя — иначе данные
    // предыдущего пользователя «воскресают» в UI уже после выхода.
    const epoch = sessionEpochRef.current;
    const stale = () => epoch !== sessionEpochRef.current;
    try {
      const user = await authApi.me();
      if (stale()) return;
      const [list, deps, collabs, cfg] = await Promise.all([
        projectsApi.list(),
        departmentsApi.list().catch(() => []),
        issuesApi.collaborating().catch(() => [] as CollaboratingItem[]),
        authApi.config().catch(() => ({ authMode: "local" as const })),
      ]);
      if (stale()) return;
      setAuthMode(cfg.authMode);
      const projects: ProjectSummary[] = list.map((p) => ({
        id: p.id,
        key: p.key,
        name: p.name,
        departmentId: p.departmentId,
        isShared: p.isShared,
        sprintsEnabled: p.sprintsEnabled,
      }));
      if (projects.length === 0) {
        // Ни одного видимого проекта, но, возможно, приглашён к отдельным задачам
        // (issue collaborators) — тогда одиночный режим (COLLAB_MIGRATION.md Фаза 6).
        if (collabs.length > 0) {
          const hash = readIssueHash();
          const openTarget = hash && collabs.some((c) => c.issueId === hash.issueId) ? hash : null;
          setSolo({ userId: user.id, userName: user.name, items: collabs, openTarget });
          setBootStatus("solo");
          return;
        }
        // users: [me] — иначе me-memo не найдёт currentUserId и свалится на
        // синтетического 'member'/'viewer' (глоб. admin потерял бы доступ к
        // AdminView, откуда только и можно создать первый проект).
        setData({ ...emptyData(), currentUserId: user.id, departments: deps, users: [mapUser(user, {})] });
        if (user.globalRole === "admin") {
          setUi((u) => ({ ...u, view: "admin" }));
          toast("info", local("Проектов пока нет — создайте первый в разделе «Департаменты»", "There are no projects yet — create the first one in Departments"));
        } else {
          toast("info", local("Вам пока не открыт ни один проект — обратитесь к администратору", "You don't have access to any projects yet — contact an administrator"));
        }
        setBootStatus("ready");
        return;
      }
      const hash = readIssueHash();
      const hashProjectVisible = !!hash && projects.some((p) => p.id === hash.projectId);
      // Прямая ссылка на приглашённую задачу (проект пользователю не открыт) —
      // ведёт в «Мои подключения», а не на главный экран (ниже по ветке ready).
      const hashIsCollab = !!hash && collabs.some((c) => c.issueId === hash.issueId);

      // ≥ 2 проектов и это НЕ переход по прямой ссылке на задачу → главный экран
      // (UI_RESTRUCTURE.md D4): список проектов и задач, в проект не входим.
      // При 1 проекте главный экран бессмыслен — сразу внутрь (ветка ниже).
      if (projects.length >= 2 && !hashProjectVisible && !hashIsCollab) {
        const assigned = await issuesApi
          .assignedToMe()
          .catch(() => ({ items: [] as AssignedIssue[], truncated: false, limit: 0 }));
        if (stale()) return;
        setData({
          ...emptyData(),
          currentUserId: user.id,
          users: [mapUser(user, {})],
          departments: deps,
          projects,
          favoriteProjectIds: user.favoriteProjectIds ?? [],
          collaborations: collabs,
          assignedToMe: assigned.items as AssignedIssue[],
          assignedTruncated: assigned.truncated,
          notifyPrefs: user.notifyPrefs ?? {},
        });
        void refreshNotifications();
        if (takeHomeIntro()) {
          toast(
            "info",
            "Теперь при входе — список ваших проектов и задач. Открыть проект напрямую можно здесь.",
          );
        }
        setBootStatus("home");
        return;
      }

      const wanted = readLastProject();
      const chosen = hashProjectVisible ? hash!.projectId : projects.find((p) => p.id === wanted)?.id ?? projects[0].id;
      const next = await buildProjectData(chosen, user.id, projects, deps, collabs, user.favoriteProjectIds ?? []);
      if (stale()) return;
      setData({ ...next, notifyPrefs: user.notifyPrefs ?? {} });
      void refreshNotifications();
      writeLastProject(chosen);
      // Прямая ссылка на приглашённую задачу (в проекте, который не открыт) —
      // сразу в раздел «Мои подключения» (Фаза 6 для пользователей с проектами).
      if (hashIsCollab) {
        setUi((u) => ({ ...u, view: "collaborating" }));
      }
      setBootStatus("ready");
    } catch (err) {
      if (stale()) return;
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        setBootStatus("unauthenticated");
        return;
      }
      handleApiError(err, local("Не удалось загрузить данные", "Couldn't load data"));
      setBootStatus("error");
    }
  }, [handleApiError, buildProjectData, toast, refreshNotifications]);

  const switchSeqRef = useRef(0);
  // Кросс-проектный переход "найти задачу → открыть её" (SearchBox): switchProject
  // ставит bootStatus в "loading", а App.tsx на это время подменяет весь Sidebar/Topbar
  // на <BootSkeleton/> — компонент поиска со своим локальным ref размонтируется и
  // отслеживание "какую задачу открыть после переключения" терялось бы вместе с ним.
  // Держим его здесь, в StoreProvider, которого этот размонт не касается.
  const pendingOpenIssueRef = useRef<{ projectId: string; issueId: string } | null>(null);
  const switchProject = useCallback(
    (projectId: string, openIssueId?: string) => {
      // Любой вызов без openIssueId — обычная навигация (ProjectSwitcher, HomeView, …),
      // которая отменяет ранее поставленное намерение "открыть задачу после переключения".
      // Без этого сброса задача из давно отменённого/перебитого поиска могла бы
      // неожиданно открыться при обычном возврате в тот же проект позже.
      pendingOpenIssueRef.current = openIssueId ? { projectId, issueId: openIssueId } : null;
      const cur = dataRef.current;
      if (projectId === cur.currentProjectId || !cur.projects.some((p) => p.id === projectId)) return;
      const seq = ++switchSeqRef.current;
      const epoch = sessionEpochRef.current; // SEC-01: ответ после logout/401 не применяем
      setBootStatus("loading");
      void (async () => {
        try {
          const next = await buildProjectData(
            projectId,
            cur.currentUserId,
            cur.projects,
            cur.departments,
            cur.collaborations,
            cur.favoriteProjectIds,
          );
          if (seq !== switchSeqRef.current || epoch !== sessionEpochRef.current) return; // более поздний клик или уже был выход
          setData(next);
          writeLastProject(projectId);
          setUi((u) => ({ ...u, selectedIssueId: null }));
          setBootStatus("ready");
        } catch (err) {
          if (seq !== switchSeqRef.current || epoch !== sessionEpochRef.current) return;
          handleApiError(err, local("Не удалось открыть проект", "Couldn't open the project"));
          setBootStatus("ready");
        }
      })();
    },
    [buildProjectData, handleApiError],
  );

  const refreshAssignedToMe = useCallback(async () => {
    const epoch = sessionEpochRef.current; // SEC-01
    try {
      const res = await issuesApi.assignedToMe();
      if (epoch !== sessionEpochRef.current) return;
      // Серверный DTO отдаёт typeId/priorityId строками — сужаем к юнионам клиента,
      // как это делалось и раньше для голого массива.
      setData((prev) => ({
        ...prev,
        assignedToMe: res.items as AssignedIssue[],
        assignedTruncated: res.truncated,
      }));
    } catch {
      /* тихо — блок «Мои задачи» просто не обновится */
    }
  }, []);

  /** Вернуться на главный экран из проекта (UI_RESTRUCTURE.md D4). Проект не
   *  выгружаем — `<HomeView>` показывается поверх; данные «Моих задач» освежаем. */
  const goHome = useCallback(() => {
    setUi((u) => ({ ...u, selectedIssueId: null, createOpen: false }));
    setBootStatus("home");
    void refreshAssignedToMe();
    void refreshNotifications();
  }, [refreshAssignedToMe, refreshNotifications]);

  /** Войти в проект с главного экрана. Тот же проект (уже загружен) — просто
   *  уходим с `<HomeView>`; другой — полноценное переключение. */
  const enterProject = useCallback(
    (projectId: string) => {
      const cur = dataRef.current;
      if (!cur.projects.some((p) => p.id === projectId)) return;
      if (projectId === cur.currentProjectId) {
        setBootStatus("ready");
      } else {
        switchProject(projectId);
      }
    },
    [switchProject],
  );

  const logout = useCallback(() => {
    // Сначала сообщаем серверу — он пометит выданные токены недействительными.
    // Ответа не ждём: локальный выход должен произойти в любом случае, даже
    // если сеть отвалилась. Ошибку глушим — токен всё равно уже стёрт.
    sessionEpochRef.current++; // SEC-01: отсекаем все запросы, начатые до выхода
    void authApi.logout().catch(() => undefined);
    clearToken();
    setData(emptyData());
    setSolo(null);
    setUi({ view: "board", selectedIssueId: null, createOpen: false, createParentId: null, lastEvent: null });
    setBootStatus("unauthenticated");
  }, []);

  const refreshIssues = useCallback(async () => {
    const requestProjectId = pid();
    // Частичный стор не перезагружает всё: наборы Списка и Доски перечитаются по ревизии.
    if (!dataRef.current.issuesComplete) {
      bumpIssues();
      return;
    }
    try {
      const issuesRes = await listAllIssues(requestProjectId);
      setData((prev) => {
        if (prev.currentProjectId !== requestProjectId) return prev;
        const byId = new Map(prev.issues.map((i) => [i.id, i]));
        return {
          ...prev,
          issues: issuesRes.items.map((dto) => mapIssue(dto, byId.get(dto.id))),
          issuesComplete: true,
        };
      });
      bumpIssues();
    } catch (err) {
      handleApiError(err);
    }
  }, [handleApiError, bumpIssues]);

  /**
   * Явная полная загрузка задач проекта — единственный осознанный потребитель «всего проекта»
   * (экран Sprints, модуль по умолчанию выключен, PERF-06 A15: «обернуть, не оптимизировать»).
   * Идемпотентна: если стор уже полный или загрузка идёт — повторного обхода нет. Уже известные
   * задачи сохраняют свои объекты (детали карточки не затираются списочной версией).
   */
  const allIssuesInFlight = useRef<Promise<void> | null>(null);
  const ensureAllIssues = useCallback((): Promise<void> => {
    if (dataRef.current.issuesComplete) return Promise.resolve();
    if (allIssuesInFlight.current) return allIssuesInFlight.current;
    const requestProjectId = pid();
    const run = (async () => {
      try {
        const res = await listAllIssues(requestProjectId);
        setData((prev) => {
          if (prev.currentProjectId !== requestProjectId) return prev;
          const known = new Map(prev.issues.map((i) => [i.id, i]));
          const merged = res.items.map((dto) => mapIssue(dto, known.get(dto.id)));
          const seen = new Set(merged.map((i) => i.id));
          // задачи, известные стору, но не пришедшие в списке (например, открытые архивные), остаются
          const extra = prev.issues.filter((i) => !seen.has(i.id));
          return { ...prev, issues: [...merged, ...extra].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)), issuesComplete: true };
        });
      } catch (err) {
        handleApiError(err, local("Не удалось загрузить задачи проекта", "Couldn't load the project's issues"));
      } finally {
        allIssuesInFlight.current = null;
      }
    })();
    allIssuesInFlight.current = run;
    return run;
  }, [handleApiError, local]);

  /** Перечитать «Мои подключения» (приглашения к задачам чужих проектов). */
  const refreshCollaborations = useCallback(async () => {
    const epoch = sessionEpochRef.current; // SEC-01
    try {
      const items = await issuesApi.collaborating();
      if (epoch !== sessionEpochRef.current) return;
      setData((prev) => ({ ...prev, collaborations: items }));
    } catch {
      /* тихо — раздел просто не обновится */
    }
  }, []);

  const openIssue = useCallback(
    (id: string | null) => {
      setUi((u) => ({ ...u, selectedIssueId: id }));
      if (!id) return;
      const requestProjectId = pid();
      if (!requestProjectId) return; // SEC-01: после выхода pid() = "", и guard `"" === ""` пропустил бы ответ
      void (async () => {
        try {
          // История задачи грузится вместе с карточкой: до этого таблица activity
          // писалась, но клиент её ниоткуда не получал, и вкладка «История»
          // всегда была пуста (аудит).
          const [dto, comments, activity] = await Promise.all([
            issuesApi.get(requestProjectId, id),
            commentsApi.list(requestProjectId, id).catch(() => []),
            issuesApi.activity(requestProjectId, id).catch(() => []),
          ]);
          setData((prev) => {
            if (prev.currentProjectId !== requestProjectId) return prev;
            const mapped = mapIssue(dto, prev.issues.find((x) => x.id === id));
            mapped.comments = (comments as { id: string; authorId: string; body: string; createdAt: string }[]).map(
              (c) => ({
                id: c.id,
                authorId: c.authorId,
                body: c.body,
                ts: Date.parse(c.createdAt) || Date.now(),
              }),
            );
            mapped.activity = activity.map((a) => ({
              id: a.id,
              authorId: a.actorId,
              author: a.actor,
              text: a.text,
              ts: Date.parse(a.createdAt) || Date.now(),
            }));
            return { ...prev, issues: upsertIssue(prev.issues, mapped) };
          });
        } catch (err) {
          handleApiError(err, local("Не удалось открыть задачу", "Couldn't open the issue"));
        }
      })();
    },
    [handleApiError],
  );

  return {
    bootstrap,
    switchProject,
    goHome,
    enterProject,
    logout,
    refreshIssues,
    ensureAllIssues,
    refreshCollaborations,
    openIssue,
    pendingOpenIssueRef,
  };
}
