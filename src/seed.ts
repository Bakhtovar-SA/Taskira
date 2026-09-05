import type { Activity, CommentT, Data, Issue, IssueTypeId, PriorityId, Sprint, Workflow } from "./types";

const NOW = Date.now();
const d = (days: number, h = 0) => NOW - days * 864e5 - h * 36e5;
const fut = (days: number) => new Date(NOW + days * 864e5).toISOString().slice(0, 10);

let n = 0;
const uid = (p: string) => `${p}-${++n}`;

export const DEFAULT_WORKFLOW: Workflow = {
  statuses: [
    { id: "todo", name: "К выполнению", category: "todo" },
    { id: "inprogress", name: "В работе", category: "inprogress" },
    { id: "review", name: "На ревью", category: "inprogress" },
    { id: "done", name: "Готово", category: "done" },
  ],
  transitions: [
    { id: "t1", from: "todo", to: "inprogress" },
    { id: "t2", from: "todo", to: "done" },
    { id: "t3", from: "inprogress", to: "todo" },
    { id: "t4", from: "inprogress", to: "review" },
    { id: "t5", from: "inprogress", to: "done" },
    { id: "t6", from: "review", to: "inprogress" },
    { id: "t7", from: "review", to: "done" },
    { id: "t8", from: "done", to: "inprogress" },
  ],
};

const USERS = [
  { id: "u1", name: "Анна Соколова", initials: "АС", color: "#0B5FD9", role: "тимлид" },
  { id: "u2", name: "Дмитрий Орлов", initials: "ДО", color: "#147A6C", role: "бэкенд" },
  { id: "u3", name: "Мария Ким", initials: "МК", color: "#B0508F", role: "фронтенд" },
  { id: "u4", name: "Иван Петров", initials: "ИП", color: "#C05A12", role: "дизайн" },
  { id: "u5", name: "Елена Волкова", initials: "ЕВ", color: "#5B5FC7", role: "QA" },
];

const SPRINTS: Sprint[] = [
  { id: "s1", name: "Спринт 7", goal: "Закрыть платёжный модуль и довести онбординг до ревью", status: "active", startDate: fut(-8), endDate: fut(6) },
  { id: "s2", name: "Спринт 8", goal: "Стабилизация биллинга и старт мобильной адаптации", status: "future", startDate: fut(7), endDate: fut(21) },
];

function mk(
  num: number,
  typeId: IssueTypeId,
  title: string,
  statusId: string,
  priorityId: PriorityId,
  assigneeId: string | null,
  points: number | null,
  labels: string[],
  epicId: string | null,
  sprintId: string | null,
  ageDays: number,
  extra?: Partial<Issue>,
): Issue {
  const created = d(ageDays, (num % 7) + 1);
  const key = `ATL-${num}`;
  const id = `i${num}`;
  const activity: Activity[] = [{ id: uid("a"), authorId: assigneeId ?? "u1", issueId: id, ts: created, text: "создал(а) задачу" }];
  return {
    id,
    key,
    title,
    description: "",
    typeId,
    statusId,
    priorityId,
    assigneeId,
    reporterId: "u1",
    epicId,
    labels,
    points,
    sprintId,
    comments: [],
    activity,
    createdAt: created,
    updatedAt: d(Math.max(0, ageDays - 2), num % 5),
    ...extra,
  };
}

export function freshData(): Data {
  n = 0;
  const comments = (list: [string, string, number][]): CommentT[] =>
    list.map(([authorId, body, days]) => ({ id: uid("c"), authorId, body, ts: d(days, 3) }));

  const issues: Issue[] = [
    /* ------- эпики ------- */
    mk(1, "epic", "Онбординг и активация", "inprogress", "high", "u1", null, ["продукт"], null, null, 34, {
      color: "#0E8FA3",
      tStart: 0,
      tSpan: 5,
      description: "Путь нового пользователя от регистрации до первого «вау»: мастер настройки, прогресс профиля, чек-лист активации команды.",
    }),
    mk(2, "epic", "Платёжный модуль", "inprogress", "highest", "u2", null, ["биллинг"], null, null, 30, {
      color: "#E07C12",
      tStart: 1,
      tSpan: 6,
      description: "Интеграция провайдера, экраны тарифов, вебхуки и безопасность повторных списаний.",
    }),
    mk(3, "epic", "Мобильная адаптация", "todo", "medium", "u3", null, ["frontend"], null, null, 21, {
      color: "#C13B8E",
      tStart: 3,
      tSpan: 5,
      description: "Адаптивная сетка дашборда, тач-сценарии и тёмная тема для планшетов и телефонов.",
    }),

    /* ------- активный спринт ------- */
    mk(4, "story", "Мастер первоначальной настройки аккаунта", "inprogress", "high", "u2", 5, ["frontend", "ux"], "i1", "s1", 12, {
      description: "Три шага: приглашение команды → импорт данных → выбор шаблона рабочих процессов.\nПрогресс сохраняется между сессиями, каждый шаг можно пропустить.",
      comments: comments([
        ["u3", "Макеты шага с импортом обновила в фигме — посмотри слой «wizard/import v3».", 4],
        ["u2", "Взял в работу. Начал с эндпоинта сохранения черновика мастера.", 2],
      ]),
    }),
    mk(5, "task", "Прогресс-бар заполнения профиля", "todo", "medium", "u3", 3, ["frontend", "ux"], "i1", "s1", 10, {
      description: "Показываем процент заполненности профиля и подсказки, чего не хватает. Анимация при изменении значения.",
    }),
    mk(6, "bug", "Не отправляется письмо с подтверждением почты", "inprogress", "highest", "u1", 2, ["api", "почта"], null, "s1", 9, {
      description: "В проде примерно 7% писем не уходят: провайдер возвращает 429. Нужен ретрай с экспоненциальной задержкой и очередь.",
      comments: comments([
        ["u5", "Воспроизвела на стейдже: при серии из 20 регистраций падают 2 письма.", 3],
        ["u1", "Добавила очередь с ретраями, жду прогон нагрузочного теста.", 1],
      ]),
    }),
    mk(7, "story", "Экран выбора тарифа при регистрации", "review", "medium", "u4", 5, ["frontend", "биллинг"], "i2", "s1", 11, {
      description: "Сравнение трёх тарифов, переключатель месяц/год со скидкой 20%. Доступность с клавиатуры обязательна.",
    }),
    mk(8, "task", "Интеграция платёжного провайдера (sandbox)", "inprogress", "high", "u2", 8, ["api", "биллинг"], "i2", "s1", 13, {
      description: "Создание платежа, вебхуки о статусе, идемпотентность по ключу запроса. Тесты на песочнице провайдера.",
      comments: comments([["u2", "Сандбокс подключён, основные сценарии зелёные. Осталась обработка 3-D Secure.", 1]]),
    }),
    mk(9, "bug", "Двойное списание при повторном клике «Оплатить»", "todo", "highest", "u5", 3, ["биллинг", "срочно"], "i2", "s1", 6, {
      description: "Если быстро кликнуть дважды, создаются два платежа. Нужна блокировка кнопки + идемпотентность на сервере.",
    }),
    mk(10, "story", "Адаптивная сетка дашборда", "done", "low", "u3", 3, ["frontend"], "i3", "s1", 15, {
      description: "Дашборд перестраивается в одну колонку до 768px, карточки складываются по приоритету контента.",
    }),
    mk(11, "task", "CI-пайплайн для мобильных сборок", "done", "medium", "u5", 2, ["devops"], null, "s1", 14, {
      description: "Сборка, прогон тестов и публикация бета-версии по тегу. Кэш зависимостей между прогонами.",
    }),
    mk(21, "bug", "Дублируются уведомления при медленном интернете", "review", "medium", "u1", 2, ["api"], null, "s1", 5, {
      description: "Клиент ретраит запрос и получает два уведомления. Дедупликация по client-id на сервере.",
    }),

    /* ------- будущий спринт ------- */
    mk(12, "story", "Чек-лист активации для новых команд", "todo", "medium", "u4", 3, ["ux"], "i1", "s2", 8, {
      description: "Пять шагов активации с отметками: пригласить коллег, создать проект, настроить роли, импортировать задачи, подключить интеграцию.",
    }),
    mk(13, "task", "Редизайн пустых состояний", "todo", "low", null, 2, ["дизайн", "ux"], "i1", "s2", 7, {
      description: "Единый стиль иллюстраций и CTA для пустых досок, бэклога и поиска.",
    }),
    mk(14, "bug", "Краш Safari при открытии модалки оплаты", "todo", "high", "u1", 2, ["frontend", "биллинг"], "i2", "s2", 6, {
      description: "Safari 16 падает на анимации backdrop-filter. Убрать блюр под модалкой для Safari.",
    }),
    mk(15, "story", "Webhook-уведомления о статусе платежа", "todo", "medium", "u2", 5, ["api"], "i2", "s2", 6, {
      description: "Подпись вебхука HMAC, повторная доставка при 5xx, журнал доставок в админке.",
    }),

    /* ------- бэклог ------- */
    mk(16, "story", "Тёмная тема интерфейса", "todo", "low", null, 8, ["дизайн"], "i3", null, 20, {
      description: "Полная палитра тёмной темы, переключатель в профиле, уважение системных настроек.",
    }),
    mk(17, "task", "Lazy-загрузка аватаров с blur-up", "todo", "medium", "u3", 2, ["frontend", "перф"], null, null, 12, {
      description: "Плейсхолдер из доминирующего цвета, превью 24px, полная версия по IntersectionObserver.",
    }),
    mk(18, "bug", "Сдвиг таблицы на экранах 1280px", "todo", "low", "u4", 1, ["frontend"], "i3", null, 9, {
      description: "Правая колонка наезжает на таблицу. Проверить брейкпоинт 1280–1360px.",
    }),
    mk(19, "story", "Импорт задач из CSV", "todo", "medium", null, 5, ["фича"], null, null, 16, {
      description: "Маппинг колонок, предпросмотр первых 10 строк, отчёт об ошибках импорта.",
    }),
    mk(20, "task", "A/B-тест онбординг-мастера", "todo", "medium", "u5", 3, ["аналитика"], "i1", null, 5, {
      description: "Вариант B: мастер из двух шагов вместо трёх. Метрика — активация за 24 часа.",
    }),
    mk(22, "task", "Документация REST API биллинга", "todo", "low", "u2", 3, ["docs", "биллинг"], "i2", null, 4, {
      description: "OpenAPI-спецификация, примеры запросов, коды ошибок и лимиты.",
    }),
  ];

  // дополнительные события в истории
  const push = (id: string, authorId: string, days: number, text: string) => {
    const iss = issues.find((i) => i.id === id)!;
    iss.activity.push({ id: uid("a"), authorId, issueId: id, ts: d(days, 2), text });
    iss.updatedAt = d(days, 2);
  };
  push("i4", "u1", 6, "переместил(а) из «К выполнению» в «В работе»");
  push("i4", "u1", 6, "назначил(а) исполнителем Дмитрия Орлова");
  push("i7", "u4", 3, "переместил(а) из «В работе» в «На ревью»");
  push("i8", "u2", 1, "изменил(а) оценку: 5 → 8");
  push("i6", "u5", 3, "переместил(а) из «К выполнению» в «В работе»");
  push("i10", "u3", 2, "переместил(а) из «На ревью» в «Готово»");
  push("i11", "u5", 2, "переместил(а) из «В работе» в «Готово»");

  return {
    project: { key: "ATL", name: "Атлас", description: "Платформа управления задачами команд" },
    users: USERS,
    currentUserId: "u1",
    issues,
    sprints: SPRINTS,
    workflow: structuredClone(DEFAULT_WORKFLOW),
    seq: 23,
  };
}
