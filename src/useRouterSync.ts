/** Синхронизация URL ↔ состояние стора (ТЗ 3.1, план v2 Трек 3) — оба направления в
 *  одном месте (см. комментарий на месте прежнего эффекта в store.tsx), чтобы не
 *  держать два независимых потребителя одной и той же ссылки:
 *
 *  - «состояние → URL»: текущий вид/проект/открытая задача сами решают, каким
 *    должен быть путь (`derivePlace`); если он отличается от того, что показывает
 *    адресная строка, — пушим его через wouter `navigate()`.
 *  - «URL → состояние»: если путь (из адресной строки — ручной ввод, кнопка «назад»,
 *    вставленная ссылка) не совпадает с тем, что дало бы текущее состояние, —
 *    разбираем путь и подгоняем состояние под него (`switchProject`/`setView`/`openIssue`).
 *
 *  Zацикливания нет: как только состояние применено, `derivePlace` при следующем
 *  рендере снова совпадёт с текущим `path`, и оба эффекта замолкают — стандартная
 *  сходимость двунаправленной синхронизации по сравнению, без флагов-заглушек. */
import { useEffect, useMemo, useReducer, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useStore } from "./store";
import { issuesApi } from "./api";
import { useT } from "./i18n";
import { resolveBootPathTarget } from "./store/mappers";
import { parsePath, pathForIssue, pathForView, samePlace, sharesIssueFilters } from "./router";
import type { Data } from "./types";
import type { BootStatus, UIState } from "./store/mappers";

/** Где должна стоять адресная строка по ТЕКУЩЕМУ состоянию: путь и ключ задачи в `?issue=`
 *  (панель задачи поверх представления, ADR-0013 §3). `undefined` — «пока не решить»
 *  (загрузка, задача выбрана, но ещё не подгружена и т.п.) — эффекты в этом случае
 *  ничего не пушат и ждут следующего рендера. */
type Place = { path: string; issue: string | null };
function derivePlace(data: Data, ui: UIState, bootStatus: BootStatus): Place | undefined {
  if (bootStatus === "home" || bootStatus === "solo") return { path: "/", issue: null };
  if (bootStatus !== "ready") return undefined;
  // «Не найдено» (ТЗ 5.12 a): адрес не трогаем — человек видит ссылку, по которой пришёл.
  if (ui.missing) return undefined;
  const proj = data.projects.find((p) => p.id === data.currentProjectId) ?? data.project;
  if (!proj.key || proj.key === "…") return undefined; // стор ещё пуст
  if (ui.selectedIssueId) {
    const issue = data.issues.find((i) => i.id === ui.selectedIssueId);
    if (!issue) return undefined; // задача ещё не в data.issues — подождать
    return ui.issueMode === "page"
      ? { path: pathForIssue(proj.key, issue.key), issue: null }
      : { path: pathForView(proj.key, ui.view, ui.section), issue: issue.key };
  }
  return { path: pathForView(proj.key, ui.view, ui.section), issue: null };
}

const issueParam = (search: string) => new URLSearchParams(search).get("issue");
/** Query с заменённым (или снятым) `issue` — остальные параметры (фильтры Списка) не трогаем. */
const withIssue = (search: string, key: string | null) => {
  const q = new URLSearchParams(search);
  if (key) q.set("issue", key);
  else q.delete("issue");
  const out = q.toString();
  return out ? `?${out}` : "";
};

export function useRouterSync(): void {
  const [path, navigate] = useLocation();
  const search = useSearch();
  const urlIssue = issueParam(search);
  const store = useStore();
  const { data, ui, bootStatus, switchProject, enterProject, openIssue, openCollabIssue, setView, goHome, toast, showMissing } = store;
  const { t } = useT();
  // Only membership/key changes invalidate routing. A refresh may return the
  // same access lists in a different order without granting or revoking access.
  const accessSignature = useMemo(() => JSON.stringify([
    data.projects.map((p) => [p.id, p.key]).sort(),
    data.collaborations.map((c) => [c.issueId, c.projectId]).sort(),
  ]), [data.projects, data.collaborations]);

  // Пока «URL → состояние» досчитывает асинхронный резолв (ключ задачи — сетевой
  // запрос), «состояние → URL» ниже обязан промолчать: состояние в этот момент ещё
  // не догнало URL, и его текущий derivePlace() — устаревший, не то, что нужно
  // показать. Без этой блокировки эффект ниже (идёт следующим в этом же коммите)
  // успевал бы переписать адресную строку на устаревший путь ДО того, как резолв
  // вообще начнётся — и он же потом читал бы уже испорченный `path` (поймано
  // App.routerSync.test.tsx: прямая ссылка на задачу схлопывалась в путь доски).
  const applyingRef = useRef(false);
  const seenUrlRef = useRef<Place | null>(null);
  const unavailableSourcesRef = useRef<string | null>(null);
  const urlChangedRef = useRef(false);
  const [urlRevision, finishUrlApplication] = useReducer((revision: number) => revision + 1, 0);
  // Capture the URL priority in commit order, never during render. This effect
  // runs before URL application can record a completed address below.
  useEffect(() => {
    const seen = seenUrlRef.current;
    urlChangedRef.current = !!seen && (seen.path !== path || seen.issue !== urlIssue);
  });

  // URL → состояние. Эффект объявлен ПЕРВЫМ специально: React выполняет эффекты
  // одного компонента по порядку объявления в рамках одного коммита, и `applyingRef`
  // должен быть выставлен синхронно до того, как «состояние → URL» (ниже) успеет
  // сверить свой derivePlace() с этим же `path`.
  useEffect(() => {
    if (bootStatus === "idle" || bootStatus === "unauthenticated" || bootStatus === "error") {
      seenUrlRef.current = null; // A fresh bootstrap must apply deep-link queries again.
      unavailableSourcesRef.current = null;
      return;
    }
    if (bootStatus !== "ready" && bootStatus !== "home") return;
    const seen = seenUrlRef.current;
    const unavailable = unavailableSourcesRef.current;
    const sourcesChanged = unavailable !== null && unavailable !== accessSignature;
    if (seen && seen.path === path && seen.issue === urlIssue && !sourcesChanged) return;
    const want = derivePlace(data, ui, bootStatus);
    if (want && want.path === path && want.issue === urlIssue) {
      seenUrlRef.current = { path, issue: urlIssue };
      unavailableSourcesRef.current = null;
      return; // уже в синхроне — нечего применять
    }
    seenUrlRef.current = null; // A retry is unprocessed until it commits too.
    unavailableSourcesRef.current = null;
    applyingRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const parsed = parsePath(path);
        if (parsed.kind === "root") {
          if (data.projects.length >= 2) goHome();
          return;
        }
        if (parsed.kind === "global") {
          setView(parsed.view, parsed.section);
          return;
        }
        // "view" и "issue" оба требуют резолва ключа проекта/задачи — переиспользуем
        // тот же резолвер, что и bootstrap() (issuesApi.resolve для ключа задачи,
        // локальный поиск по data.projects для ключа проекта). `path` — тот самый,
        // что уже проверен выше, не текущий location.pathname (см. комментарий
        // resolveBootPathTarget в store/mappers.ts).
        const target = await resolveBootPathTarget(path, data.projects);
        if (cancelled) return;
        // Ключ не найден или недоступен — «Не найдено» (ТЗ 5.12 a) вместо тихого «остаёмся как есть».
        if (!target) {
          if (parsed.kind === "view" || parsed.kind === "issue") unavailableSourcesRef.current = accessSignature;
          return showMissing(path);
        }
        if (target.kind === "view") {
          // `?issue=KEY` — панель задачи поверх представления. Ключ ищем сначала среди
          // загруженных задач, иначе спрашиваем сервер (ключ глобально уникален).
          const local = target.projectId === data.currentProjectId ? data.issues.find((i) => i.key === urlIssue) : undefined;
          const res = !urlIssue ? null : local ? { id: local.id, projectId: target.projectId } : await issuesApi.resolve(urlIssue).catch(() => null);
          if (cancelled) return;
          // Resolve before switching: the project and its pending panel must be
          // committed together, rather than reusing the pre-switch project closure.
          const projectId = res?.projectId ?? target.projectId;
          if (!data.projects.some((p) => p.id === projectId)) {
            unavailableSourcesRef.current = accessSignature;
            return showMissing(path);
          }
          if (projectId !== data.currentProjectId) switchProject(projectId, res?.id);
          else {
            if (bootStatus === "home") enterProject(projectId);
            if (res || ui.selectedIssueId) openIssue(res?.id ?? null);
          }
          setView(target.view, target.section);
          return;
        }
        // Прямая ссылка на приглашённую задачу (не в открытом проекте) — в «Мои подключения» с выбранной карточкой,
        // как при входе через bootstrap() (ROUTE-01: раньше посреди сессии открывался только список).
        if (data.collaborations.some((c) => c.issueId === target.issueId)) {
          openCollabIssue(target.issueId);
          return;
        }
        if (target.projectId === data.currentProjectId) {
          if (bootStatus === "home") enterProject(target.projectId);
          openIssue(target.issueId, "page");
        }
        else if (data.projects.some((p) => p.id === target.projectId)) switchProject(target.projectId, target.issueId, "page");
        else {
          unavailableSourcesRef.current = accessSignature;
          showMissing(path);
        }
      } finally {
        if (!cancelled) {
          seenUrlRef.current = { path, issue: urlIssue };
          applyingRef.current = false;
          // Even a no-op or an invalid issue query needs one committed render
          // so state → URL can canonicalize after the external URL has settled.
          finishUrlApplication();
        }
      }
    })();
    return () => {
      cancelled = true;
      applyingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- изменения задач/UI не переигрывают URL.
    // Списки доступа нужны для отмены устаревшего резолва и повторного поиска недоступного проекта.
  }, [path, urlIssue, bootStatus, accessSignature]);

  // Спринты при выключенном модуле — на доску с объяснением, а не экран-отказ (ADR-0013 §5).
  // Отдельным эффектом: вид могли выставить и bootstrap() по прямой ссылке, и переход выше.
  const sprintsOff = bootStatus === "ready" && ui.view === "sprints" && !!data.project.key && !data.project.sprintsEnabled;
  useEffect(() => {
    if (!sprintsOff) return;
    toast("info", t("router.sprintsOff"));
    setView("board");
  }, [sprintsOff, toast, t, setView]);

  // Состояние → URL.
  useEffect(() => {
    if (applyingRef.current || urlChangedRef.current) return; // URL navigation wins in this commit.
    const want = derivePlace(data, ui, bootStatus);
    if (!want || (want.path === path && want.issue === urlIssue)) return;
    // Старый адрес того же места (/p/K/backlog?status=… → /p/K/list?status=…, ADR-0013 §5) и
    // переход между задачами в открытой панели (J/K) — заменить запись истории, а не добавить;
    // query сохраняется — в нём фильтры списка. Открыть/закрыть панель — новая запись:
    // «назад» закрывает панель.
    const legacy = want.path !== path && samePlace(path, want.path);
    const replace = legacy || (want.path === path && !!want.issue && !!urlIssue);
    const q = withIssue(legacy || want.path === path || sharesIssueFilters(path, want.path) ? location.search : "", want.issue);
    // Our own navigation already represents state. Reapplying an intermediate
    // board URL would close a pending issue opened after switchProject().
    seenUrlRef.current = { path: want.path, issue: want.issue };
    const hash = want.path === path ? location.hash : "";
    navigate(`${want.path}${q}${hash}`, { replace });
  }, [data, ui, bootStatus, path, urlIssue, navigate, urlRevision]);
}
