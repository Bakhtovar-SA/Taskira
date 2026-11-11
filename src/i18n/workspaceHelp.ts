import type { HelpSection } from "./help";
import type { Lang } from "../i18n";
import { projectModulesCopy } from "./projectModules";

export function workspaceHelp(lang: Lang): HelpSection[] {
  const copy = projectModulesCopy(lang),
    m = copy.modules;
  const section = (
    id: keyof typeof m,
    label: string,
    details: string[],
  ): HelpSection => ({
    id: id === "planning" ? "forecasts" : id,
    label,
    paragraphs: [m[id].purpose, m[id].example, ...details],
  });
  if (lang === "en")
    return [
      {
        id: "modules",
        label: "Project modules",
        paragraphs: [
          "Open Project settings → Modules. Each project has switches for Sprints, Documents, Objects, Processes, Planning and Files. Changes save immediately. Managers and administrators configure workspace modules; Sprints requires administrator permission. Other members can read the settings.",
          copy.disabled,
          copy.filesDisabled,
          "Documents, Objects, Processes and Planning start disabled. Files starts enabled to keep existing attachments discoverable. A module does not grant additional project access.",
        ],
        table: {
          headers: ["Module", "Use it for"],
          rows: [
            [
              "Sprints",
              "A fixed work period: select tasks, start the sprint and complete it, returning unfinished work to the backlog.",
            ],
            ...Object.values(m).map((item) => [item.name, item.purpose]),
          ],
        },
      },
      section("documents", "Documents", [
        "Members create and edit documents; viewers read them. Several authors can edit together and see participants and cursors. Saved on server means PostgreSQL acknowledged the write. During a connection loss, edits stay in the open tab's memory and sync on reconnection; closing an unsynced tab can lose them.",
        "Use Comments, Versions, Links and Properties. A comment can refer to a selected block and be resolved. Automatic checkpoints and named versions preserve history. Restore creates a new revision and reconnects editors. Images and attachments pass the usual file checks.",
        "A manager or administrator verifies a specific version until a chosen date. Editing shows Changed after verification; the previous verification stays with its version. The owner receives an internal reminder when review is due.",
        "Select a passage, choose Create task from selection, review the title, description, object and process, then confirm. The document receives a live task link; the task keeps a link to the source block. Task creation is always explicit.",
      ]),
      section("objects", "Objects and registers", [
        "A manager or administrator defines object types with text, number, date, selection, checkbox, user or same-project object fields. These fields are separate from task fields. Members add and edit records; viewers read them.",
        "Use search, filters, sorting and column selection. A card shows properties, linked tasks, documents, process runs and history. Create task from the card to keep its object link. Open-task and last-process figures come from linked data.",
        "Archiving keeps the record and links. If another member changed it before your save, refresh after the version-conflict message before applying your changes again. Object-to-object links are limited to one project.",
      ]),
      section("processes", "Processes and automation", [
        "A process template coordinates several tasks; the task workflow still defines allowed statuses and transitions. Managers and administrators prepare a draft, check the graph, preview and publish it. Published versions are immutable. Editing creates a new version; existing runs keep their template and instruction versions.",
        "Choose participants, an object and parameters before confirming a launch. Independent steps run in parallel; dependent or conditional steps wait. Tasks are created when their step opens. Future steps are visible in the run and can enter a plan.",
        "Closing a step task advances the run or requests approval. Approval releases dependent work; returning for changes keeps the step open. Pause stops new steps without moving existing task dates. Resume, cancellation, errors and retries appear in the log.",
        "Automation rules combine an event, all/any conditions and actions: create a task, change supported fields or assignees, send an internal notification or launch a published process. Preview checks an example without execution. Rules use their owner's current permissions; lost access stops execution, and repeated event delivery does not duplicate work.",
      ]),
      section("planning", "Planning and forecasts", [
        "Create a plan with tasks and future process steps, ordered by priority and dependencies. A future step and its created task count once; multiple assignees do not multiply scope. Completed work is excluded from the remaining forecast.",
        "A saved plan scenario has its own scope and order. Compare urgent work or new requirements without changing real task assignees, statuses or dates. A plan scenario is a comparison tool, distinct from a real-life usage example.",
        "The forecast uses 10,000 samples of weekly completed work from up to 12 full weeks, separately by complexity, including Unestimated. Median and 80th-percentile completion weeks are estimates. At least four complete weeks, 20 completed tasks and history for every complexity in the plan are required. Otherwise Taskira explains the missing data and leaves the date empty. No hour tracking is used.",
      ]),
      section("files", "Project files", [
        "Search by file name, task key or source title. Filter Tasks or Documents; sort by name, size or upload time. Each file shows its source, size, author and date, with download and source-opening actions. Narrow screens show the same files as cards.",
        "Upload or remove a file in its original task or document; the catalogue reflects changes without copying it. Uploaded document images appear too; an external image URL is not a stored attachment. Archived sources remain searchable.",
        copy.filesDisabled,
      ]),
      {
        id: "library",
        label: "Library",
        paragraphs: [
          "Library in the personal menu brings together tasks, documents, objects and process runs from projects you can access. Search titles and indexed text, filter by project and material type, then open the original material.",
          "Library indexes materials across projects; Files indexes attachments in one project. Neither duplicates the data. An invitation to one task does not reveal the project's other materials.",
        ],
      },
      {
        id: "workspace-example",
        label: "Example: reviewing a portal",
        paragraphs: [
          "Before a portal update, Anna asks Mikhail to review its settings. They keep the instruction, work and result in one project.",
          "1. Anna opens the Corporate portal object, finds its owner and agreed instruction, and launches a review process with Mikhail as assignee. The run pins that instruction version.",
          "2. Mikhail opens the first step task, follows the instruction, uploads a report to the task and records findings in a document. Colleagues edit the result together and discuss a particular block.",
          "3. The review finds a legacy protocol. Mikhail selects the finding and creates a remediation task linked to its source block, portal and process. Anna adds remediation and the future follow-up review to a plan, checking workload and available forecast history.",
          "4. Mikhail applies the change, attaches evidence and completes remediation. The dependent follow-up step opens. After its task is completed, Anna reviews and approves the result. An outstanding mandatory approval prevents the process from finishing.",
          "5. The final document version is verified. Later the portal card shows the instruction, result, tasks and process log. Files finds both the task attachment and document report without opening each task.",
        ],
      },
    ];
  return [
    {
      id: "modules",
      label: "Модули проекта",
      paragraphs: [
        "Откройте Настройки проекта → Модули. У каждого проекта свои переключатели: Спринты, Документы, Объекты, Процессы, Планирование и Файлы. Изменения сохраняются сразу. Модулями рабочего пространства управляют менеджер и администратор; спринтами — администратор. Остальные участники могут просматривать настройки.",
        copy.disabled,
        copy.filesDisabled,
        "Документы, объекты, процессы и планирование изначально выключены. Каталог файлов включён, чтобы существующие вложения оставались доступны для поиска. Модуль не расширяет доступ к проекту.",
      ],
      table: {
        headers: ["Модуль", "Для чего нужен"],
        rows: [
          [
            "Спринты",
            "Рабочий период с выбранными задачами: запустить спринт, завершить его и вернуть незавершённую работу в бэклог.",
          ],
          ...Object.values(m).map((item) => [item.name, item.purpose]),
        ],
      },
    },
    section("documents", "Документы", [
      "Участники создают и редактируют документы; наблюдатели читают. Несколько авторов работают одновременно, видят участников и курсоры. «Сохранено на сервере» означает подтверждённую запись в PostgreSQL. При потере связи правки остаются в памяти открытой вкладки и синхронизируются после подключения; закрытие несинхронизированной вкладки может их потерять.",
      "Справа находятся Комментарии, Версии, Связи и Свойства. Комментарий можно привязать к выделенному блоку и закрыть после обсуждения. Автоматические и именованные версии сохраняют историю. Восстановление создаёт новую редакцию и переподключает редакторов. Изображения и вложения проходят общие проверки файлов.",
      "Менеджер или администратор подтверждает конкретную версию до выбранной даты. Изменение даёт отметку «Изменён после подтверждения»; прежнее подтверждение остаётся у своей версии. При наступлении даты пересмотра ответственный получает внутреннее уведомление.",
      "Выделите текст, нажмите «Создать задачу из текста», проверьте название, описание, объект и процесс, затем подтвердите форму. В документе появится живая ссылка со статусом задачи, в задаче — ссылка на исходный блок. Создание всегда выполняется явно пользователем.",
    ]),
    section("objects", "Объекты и реестры", [
      "Менеджер или администратор настраивает типы объектов и поля: текст, число, дата, список, флажок, пользователь или другой объект этого проекта. Поля объектов отделены от полей задач. Участники добавляют и изменяют записи; наблюдатели читают.",
      "В реестре доступны поиск, фильтры, сортировка и выбор колонок. В карточке — свойства, связанные задачи, документы, запуски процессов и история. Действие «Создать задачу» сохраняет связь с объектом. Счётчики открытых задач и последнего завершённого процесса вычисляются по связанным данным.",
      "Архивирование сохраняет запись и ссылки. Если другой участник успел изменить запись, обновите её после сообщения о конфликте версии перед повторным сохранением. Связи между объектами ограничены одним проектом.",
    ]),
    section("processes", "Процессы и автоматизации", [
      "Шаблон процесса связывает несколько задач в последовательность; рабочий процесс задач по-прежнему задаёт разрешённые статусы и переходы. Менеджер или администратор готовит черновик, проверяет граф, смотрит предпросмотр и публикует. Опубликованная версия неизменяема. Правки создают новую; запущенная работа сохраняет свою версию шаблона и инструкций.",
      "Перед запуском выберите участников, объект и параметры и подтвердите список работы. Независимые этапы идут параллельно; зависимые и условные ждут очереди. Задачи создаются при открытии этапов. Будущие шаги видны в запуске и могут попасть в план.",
      "Завершение задачи этапа открывает следующий шаг или проверку результата. Подтверждение освобождает зависимую работу; возврат на доработку удерживает этап открытым. Пауза останавливает новые этапы без переноса сроков существующих задач. Возобновление, отмена, ошибки и повторы отражаются в журнале.",
      "Правило автоматизации объединяет событие, условия «И»/«ИЛИ» и действия: создать задачу, изменить поддерживаемые поля или исполнителей, отправить внутреннее уведомление, запустить опубликованный процесс. Предпросмотр проверяет пример без выполнения. Правило использует текущие права владельца; потеря доступа останавливает выполнение, повторная доставка события не дублирует работу.",
    ]),
    section("planning", "Планирование и прогнозы", [
      "Создайте план с задачами и будущими этапами процессов, задайте порядок по приоритетам и зависимостям. Будущий этап и созданная из него задача учитываются один раз; несколько исполнителей не увеличивают объём. Завершённая работа исключается из оставшегося прогноза.",
      "Сохранённый сценарий плана хранит свой состав и порядок. Сравнивайте срочную работу или дополнительные требования без изменения реальных исполнителей, статусов и сроков задач. Сценарий плана — инструмент сравнения; жизненный пример использования описывает действия людей.",
      "Прогноз использует 10 000 выборок недельного объёма завершённой работы за последние 12 полных недель, отдельно по сложности, включая «Без оценки». Медианная неделя и 80-й процентиль — расчётные ориентиры. Нужны минимум четыре полные недели, 20 завершённых задач и история каждой сложности из плана. Иначе Taskira объясняет недостаток данных и не подставляет дату. Учёт часов не используется.",
    ]),
    section("files", "Файлы проекта", [
      "Ищите по имени файла, ключу задачи или названию источника. Фильтр «Где используется» разделяет задачи и документы; сортировка работает по названию, размеру и времени добавления. У файла видны источник, размер, автор, дата, скачивание и переход к исходному материалу. На узком экране те же файлы показаны карточками.",
      "Добавляйте и удаляйте файл в исходной задаче или документе: каталог отражает изменения без создания копии. Загруженные изображения из вложений документа тоже видны; внешняя ссылка на изображение не является сохранённым вложением. Архивные источники остаются доступны для поиска.",
      copy.filesDisabled,
    ]),
    {
      id: "library",
      label: "Библиотека",
      paragraphs: [
        "Библиотека в личном меню собирает задачи, документы, объекты и запуски процессов из доступных проектов. Ищите по названию и индексируемому тексту, выбирайте проект и тип материала, затем открывайте исходную запись.",
        "Библиотека — общий каталог материалов разных проектов; Файлы — каталог вложений одного проекта. Оба используют исходные данные без дублирования. Приглашение к одной задаче не открывает остальные материалы её проекта.",
      ],
    },
    {
      id: "workspace-example",
      label: "Пример: проверка портала",
      paragraphs: [
        "Перед обновлением корпоративного портала Анна поручает Михаилу проверить настройки. Инструкция, выполнение и результат остаются в одном проекте.",
        "1. Анна открывает объект «Корпоративный портал», находит владельца и согласованную инструкцию, запускает процесс проверки с Михаилом в роли исполнителя. Запуск фиксирует версию инструкции.",
        "2. Михаил открывает задачу первого этапа, выполняет проверку, прикладывает протокол к задаче и записывает замечания в документ. Коллеги вместе редактируют результат и обсуждают конкретный блок.",
        "3. Обнаружен устаревший протокол. Михаил выделяет замечание и создаёт задачу на исправление со связями с исходным блоком, объектом и процессом. Анна добавляет исправление и будущую повторную проверку в план, оценивает нагрузку и доступную историю для прогноза.",
        "4. Михаил меняет настройку, прикладывает подтверждение и завершает исправление. Открывается зависимый этап повторной проверки. После завершения его задачи Анна проверяет и подтверждает результат. Незавершённое обязательное подтверждение удерживает процесс от завершения.",
        "5. Итоговая версия документа подтверждается. Позже в карточке портала находятся инструкция, результат, задачи и журнал процесса. Через «Файлы» можно найти протокол из задачи и отчёт из документа без просмотра каждой задачи отдельно.",
      ],
    },
  ];
}
