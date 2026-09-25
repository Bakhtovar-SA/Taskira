/** Синхронизация URL ↔ состояние стора (ТЗ 3.1, план v2 Трек 3) — оба направления в
 *  одном месте (см. комментарий на месте прежнего эффекта в store.tsx), чтобы не
 *  держать два независимых потребителя одной и той же ссылки:
 *
 *  - «состояние → URL»: текущий вид/проект/открытая задача сами решают, каким
 *    должен быть путь (`derivePath`); если он отличается от того, что показывает
 *    адресная строка, — пушим его через wouter `navigate()`.
 *  - «URL → состояние»: если путь (из адресной строки — ручной ввод, кнопка «назад»,
 *    вставленная ссылка) не совпадает с тем, что дало бы текущее состояние, —
 *    разбираем путь и подгоняем состояние под него (`switchProject`/`setView`/`openIssue`).
 *
 *  Zацикливания нет: как только состояние применено, `derivePath` при следующем
 *  рендере снова совпадёт с текущим `path`, и оба эффекта замолкают — стандартная
 *  сходимость двунаправленной синхронизации по сравнению, без флагов-заглушек. */
import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useStore } from "./store";
import { useT } from "./i18n";
import { resolveBootPathTarget } from "./store/mappers";
import { parsePath, pathForIssue, pathForView, samePlace } from "./router";
import type { Data } from "./types";
import type { BootStatus, UIState } from "./store/mappers";

/** Каким должен быть путь по ТЕКУЩЕМУ состоянию. `undefined` — «пока не решить»
 *  (загрузка, задача выбрана, но ещё не подгружена и т.п.) — эффекты в этом случае
 *  ничего не пушат и ждут следующего рендера. */
function derivePath(data: Data, ui: UIState, bootStatus: BootStatus): string | undefined {
  if (bootStatus === "home" || bootStatus === "solo") return "/";
  if (bootStatus !== "ready") return undefined;
  const proj = data.projects.find((p) => p.id === data.currentProjectId) ?? data.project;
  if (!proj.key || proj.key === "…") return undefined; // стор ещё пуст
  if (ui.selectedIssueId) {
    const issue = data.issues.find((i) => i.id === ui.selectedIssueId);
    return issue ? pathForIssue(proj.key, issue.key) : undefined; // задача ещё не в data.issues — подождать
  }
  return pathForView(proj.key, ui.view);
}

export function useRouterSync(): void {
  const [path, navigate] = useLocation();
  const store = useStore();
  const { data, ui, bootStatus, switchProject, openIssue, setView, goHome, toast } = store;
  const { t } = useT();

  // Пока «URL → состояние» досчитывает асинхронный резолв (ключ задачи — сетевой
  // запрос), «состояние → URL» ниже обязан промолчать: состояние в этот момент ещё
  // не догнало URL, и его текущий derivePath() — устаревший, не то, что нужно
  // показать. Без этой блокировки эффект ниже (идёт следующим в этом же коммите)
  // успевал бы переписать адресную строку на устаревший путь ДО того, как резолв
  // вообще начнётся — и он же потом читал бы уже испорченный `path` (поймано
  // App.routerSync.test.tsx: прямая ссылка на задачу схлопывалась в путь доски).
  const applyingRef = useRef(false);

  // URL → состояние. Эффект объявлен ПЕРВЫМ специально: React выполняет эффекты
  // одного компонента по порядку объявления в рамках одного коммита, и `applyingRef`
  // должен быть выставлен синхронно до того, как «состояние → URL» (ниже) успеет
  // сверить свой derivePath() с этим же `path`.
  useEffect(() => {
    if (bootStatus !== "ready") return; // логин/логаут/ошибка — не наше дело здесь
    if (derivePath(data, ui, bootStatus) === path) return; // уже в синхроне — нечего применять
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
        if (target.projectId === data.currentProjectId) openIssue(target.issueId);
        else if (data.projects.some((p) => p.id === target.projectId)) switchProject(target.projectId, target.issueId);
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
  }, [path, bootStatus]);

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
    const target = derivePath(data, ui, bootStatus);
    if (!target || target === path) return;
    // Старый адрес того же места (/p/K/backlog?status=… → /p/K/list?status=…, ADR-0013 §5):
    // заменить запись истории, а не добавить, и сохранить query — в нём фильтры списка.
    if (samePlace(path, target)) navigate(`${target}${location.search}`, { replace: true });
    else navigate(target, { replace: false });
  }, [data, ui, bootStatus, path, navigate]);
}
