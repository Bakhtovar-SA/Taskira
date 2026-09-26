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
import { useEffect, useRef } from "react";
import { useLocation, useSearch } from "wouter";
import { useStore } from "./store";
import { issuesApi } from "./api";
import { useT } from "./i18n";
import { resolveBootPathTarget } from "./store/mappers";
import { parsePath, pathForIssue, pathForView, samePlace } from "./router";
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
  const proj = data.projects.find((p) => p.id === data.currentProjectId) ?? data.project;
  if (!proj.key || proj.key === "…") return undefined; // стор ещё пуст
  if (ui.selectedIssueId) {
    const issue = data.issues.find((i) => i.id === ui.selectedIssueId);
    if (!issue) return undefined; // задача ещё не в data.issues — подождать
    return ui.issueMode === "page"
      ? { path: pathForIssue(proj.key, issue.key), issue: null }
      : { path: pathForView(proj.key, ui.view), issue: issue.key };
  }
  return { path: pathForView(proj.key, ui.view), issue: null };
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
  const { data, ui, bootStatus, switchProject, openIssue, setView, goHome, toast } = store;
  const { t } = useT();

  // Пока «URL → состояние» досчитывает асинхронный резолв (ключ задачи — сетевой
  // запрос), «состояние → URL» ниже обязан промолчать: состояние в этот момент ещё
  // не догнало URL, и его текущий derivePlace() — устаревший, не то, что нужно
  // показать. Без этой блокировки эффект ниже (идёт следующим в этом же коммите)
  // успевал бы переписать адресную строку на устаревший путь ДО того, как резолв
  // вообще начнётся — и он же потом читал бы уже испорченный `path` (поймано
  // App.routerSync.test.tsx: прямая ссылка на задачу схлопывалась в путь доски).
  const applyingRef = useRef(false);

  // URL → состояние. Эффект объявлен ПЕРВЫМ специально: React выполняет эффекты
  // одного компонента по порядку объявления в рамках одного коммита, и `applyingRef`
  // должен быть выставлен синхронно до того, как «состояние → URL» (ниже) успеет
  // сверить свой derivePlace() с этим же `path`.
  useEffect(() => {
    if (bootStatus !== "ready") return; // логин/логаут/ошибка — не наше дело здесь
    const want = derivePlace(data, ui, bootStatus);
    if (want && want.path === path && want.issue === urlIssue) return; // уже в синхроне — нечего применять
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
          setView(parsed.view);
          return;
        }
        // "view" и "issue" оба требуют резолва ключа проекта/задачи — переиспользуем
        // тот же резолвер, что и bootstrap() (issuesApi.resolve для ключа задачи,
        // локальный поиск по data.projects для ключа проекта). `path` — тот самый,
        // что уже проверен выше, не текущий location.pathname (см. комментарий
        // resolveBootPathTarget в store/mappers.ts).
        const target = await resolveBootPathTarget(path, data.projects);
        if (cancelled || !target) return; // ключ не найден/недоступен — молча остаёмся как есть
        if (target.kind === "view") {
          if (target.projectId !== data.currentProjectId) switchProject(target.projectId);
          setView(target.view);
          // `?issue=KEY` — панель задачи поверх представления. Ключ ищем сначала среди
          // загруженных задач, иначе спрашиваем сервер (ключ глобально уникален).
          if (!urlIssue) {
            if (ui.selectedIssueId) openIssue(null);
            return;
          }
          const local = target.projectId === data.currentProjectId ? data.issues.find((i) => i.key === urlIssue) : undefined;
          const res = local ? { id: local.id, projectId: target.projectId } : await issuesApi.resolve(urlIssue).catch(() => null);
          if (cancelled || !res) return;
          if (res.projectId === data.currentProjectId) openIssue(res.id);
          else if (data.projects.some((p) => p.id === res.projectId)) switchProject(res.projectId, res.id);
          return;
        }
        // Прямая ссылка на приглашённую задачу (не в открытом проекте) — в «Мои
        // подключения»; выбор конкретной карточки там (в отличие от свежего входа
        // через bootstrap()) в этом релизе не подхватывается — список остаётся,
        // выбрать нужно вручную (честно: не то же покрытие, что у входа с нуля).
        if (data.collaborations.some((c) => c.issueId === target.issueId)) {
          setView("collaborating");
          return;
        }
        if (target.projectId === data.currentProjectId) openIssue(target.issueId, "page");
        else if (data.projects.some((p) => p.id === target.projectId)) switchProject(target.projectId, target.issueId, "page");
      } finally {
        if (!cancelled) applyingRef.current = false;
      }
    })();
    return () => {
      cancelled = true;
      applyingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- намеренно только [path, bootStatus]: остальное читаем
    // через `data`/`ui` в замыкании на момент срабатывания, а не как повод для повторного запуска (иначе каждое
    // изменение стора в другом месте приложения тоже пыталось бы «догонять» URL этим эффектом).
  }, [path, urlIssue, bootStatus]);

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
    if (applyingRef.current) return; // см. комментарий у applyingRef выше
    const want = derivePlace(data, ui, bootStatus);
    if (!want || (want.path === path && want.issue === urlIssue)) return;
    // Старый адрес того же места (/p/K/backlog?status=… → /p/K/list?status=…, ADR-0013 §5) и
    // переход между задачами в открытой панели (J/K) — заменить запись истории, а не добавить;
    // query сохраняется — в нём фильтры списка. Открыть/закрыть панель — новая запись:
    // «назад» закрывает панель.
    const legacy = want.path !== path && samePlace(path, want.path);
    const replace = legacy || (want.path === path && !!want.issue && !!urlIssue);
    // Другое место — чистый адрес (фильтры одного вида не переезжают в другой).
    const q = withIssue(legacy || want.path === path ? location.search : "", want.issue);
    navigate(`${want.path}${q}`, { replace });
  }, [data, ui, bootStatus, path, urlIssue, navigate]);
}
