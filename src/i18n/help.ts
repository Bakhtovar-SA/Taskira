export type HelpSection = { id: string; label: string; paragraphs: string[]; table?: { headers: string[]; rows: string[][] } };
export type HelpCopy = { title: string; subtitle: string; permission: string; sections: HelpSection[] };

export const helpCopy: Record<"ru" | "en", HelpCopy> = {
  "ru": {
    "title": "Документация Taskira",
    "subtitle": "Работа с проектами, задачи, планирование и настройки",
    "sections": [
      {
        "id": "overview",
        "label": "Обзор системы",
        "paragraphs": [
          "Taskira объединяет проекты и задачи. Доска, список, календарь и таймлайн показывают одну и ту же работу разными способами; изменение задачи отражается во всех видах.",
          "Начните с выбора проекта и создания задачи. На доске задачи расположены по статусам; список удобен для поиска и массовых действий, календарь — для сроков, таймлайн — для направлений.",
          "Настройки организации, команды, создание проектов и рабочий процесс доступны администратору. Интерфейс объясняет недоступные действия, а окончательное решение о доступе принимает сервер."
        ]
      },
      {
        "id": "roles",
        "label": "Роли и права",
        "paragraphs": [
          "Роль назначается отдельно в каждом проекте: менеджер, сотрудник или наблюдатель. Глобальный администратор имеет доступ ко всем проектам. Видимость проекта через команду или общий доступ не означает право изменять его настройки.",
          "Сотрудник редактирует и перемещает задачи, где он автор или исполнитель. Наблюдатель читает задачи. Приглашение к одной задаче открывает именно её и обсуждение, не делает человека участником всего проекта.",
          "Таблица ниже показывает ролевые разрешения. Для действий с задачей дополнительно учитываются её автор, исполнители и приглашённые участники; доступные кнопки могут отличаться даже у двух людей с одной ролью."
        ]
      },
      {
        "id": "workflow",
        "label": "Рабочий процесс",
        "paragraphs": [
          "Рабочий процесс задаёт статусы проекта и разрешённые переходы. Категории «к выполнению», «в работе» и «готово» определяют смысл статуса и используются в отчётах, прогрессе и завершении спринта.",
          "На доске и в карточке можно выбрать только допустимый переход при наличии права на задачу. Запрещённое перемещение отклоняется сервером. Названия статусов могут отличаться между проектами.",
          "Администратор меняет рабочий процесс и настраивает пользовательские поля и шаблоны задач. Эти изменения действуют на проект; менеджер управляет работой, но не получает право менять схему."
        ]
      },
      {
        "id": "issues",
        "label": "Карточка задачи",
        "paragraphs": [
          "Задача хранит название, описание, тип, приоритет, статус, срок, сложность, метки, автора, исполнителей, направление, подзадачи, связи, чек-лист, пользовательские поля, вложения, комментарии и историю. Введённые пользователем тексты не переводятся.",
          "Исполнителей может быть несколько или ни одного. Поиск исполнителей показывает участников проекта; ранее назначенного человека можно снять после его выхода из проекта. Приглашённый участник — отдельная роль в обсуждении одной задачи, а не исполнитель.",
          "Подзадача имеет собственный статус и срок; поддерживаются два уровня, без подзадач у подзадачи. Чек-лист содержит до 50 простых пунктов без отдельного исполнителя. Пользовательские поля бывают текстовыми, числовыми, списком, флажком или датой.",
          "Приоритет показывает важность, сложность — оценку трудности. Связи «связана с», «блокирует» и «заблокирована» описывают отношения задач; сами по себе они не меняют статус или срок. Подробнее — в разделе планирования."
        ]
      },
      {
        "id": "list",
        "label": "Список задач",
        "paragraphs": [
          "Список задач — таблица с поиском, сортировкой и фильтрами по статусу, исполнителю, типу, приоритету, метке, срокам, спринту, просрочке и пользовательскому полю. Условия сохраняются в адресной строке.",
          "Фильтр можно сохранить под названием и выбрать как свой вид по умолчанию. Сортировка доступна по приоритету, сроку, обновлению и ключу; количество видимых строк не ограничивает число задач проекта.",
          "«Выделить» включает массовую смену статуса, исполнителя, приоритета или удаление с проверкой прав каждой задачи. Импорт поддерживает доступные в окне импорта форматы Trello, Jira и Asana; проверьте предпросмотр перед подтверждением."
        ]
      },
      {
        "id": "sprints",
        "label": "Спринты",
        "paragraphs": [
          "Спринты — опциональный модуль проекта. Администратор включает его в настройках; без него можно работать через доску и список. Менеджеры и администраторы создают, запускают и завершают спринты.",
          "Спринт бывает будущим, активным или завершённым. Одновременно активен только один спринт проекта. Цель спринта объясняет ожидаемый результат, а состав задач можно менять при наличии прав.",
          "При завершении незакрытые задачи возвращаются в бэклог, а закрытые остаются в завершённом спринте. Автоматического переноса в следующий спринт нет."
        ]
      },
      {
        "id": "notifications",
        "label": "Уведомления",
        "paragraphs": [
          "«Входящие» показывают уведомления о назначении, комментариях, упоминаниях, смене статуса, приглашениях и членстве. Свои действия обычно не создают уведомления самому автору.",
          "Получатели зависят от события и доступа к задаче: автор, исполнители, наблюдатели или приглашённые участники. Упоминание @логин уведомляет человека, если ему доступна задача.",
          "В личных настройках выбираются уведомления, автоматическое наблюдение и email-режим: сразу или сводкой. Почта работает только при настройке отправки администратором сервера и наличии адреса пользователя."
        ]
      },
      {
        "id": "attachments",
        "label": "Вложения",
        "paragraphs": [
          "Файлы добавляются в карточке задачи пользователем с правом комментирования. По умолчанию — до 50 файлов, каждый до 25 МБ; сервер может задавать другие пределы.",
          "Загрузивший файл или пользователь с правом удаления задач может убрать вложение. Проверки типа и размера выполняются на сервере; скачивание требует доступа к задаче.",
          "Файлы хранятся на диске сервера или в настроенном S3-совместимом хранилище. Для пользователя способ добавления и скачивания одинаков. Фото аватара имеет отдельные ограничения — см. оформление."
        ]
      },
      {
        "id": "departments",
        "label": "Команды и LDAP",
        "paragraphs": [
          "Проект виден глобальному администратору, его явным участникам, членам команды проекта либо всем пользователям, если он общий. Видимость и право изменения — разные вещи; роль задаётся отдельно.",
          "В режиме LDAP/AD группы каталога могут определять членство в командах. Администратор связывает команду с группой и запускает пересинхронизацию; ручное членство сохраняется и управляется отдельно.",
          "Приветствие использует имя givenName из каталога. Оно обновляется при входе и ресинхронизации; пустой ответ ресинка не стирает ранее сохранённое имя. Если имя неизвестно, отображается полное имя без угадывания порядка фамилии и имени."
        ]
      },
      {
        "id": "reports",
        "label": "Отчёты",
        "paragraphs": [
          "Отчёты показывают созданные, закрытые, открытые и просроченные задачи и время выполнения за выбранный период. Используйте фильтры, чтобы сравнивать нужную часть работы.",
          "Данные можно группировать по проекту, исполнителю, типу и приоритету и выгружать в CSV. В отчёт попадают доступные пользователю данные; отчёт не даёт доступа к чужому проекту."
        ]
      },
      {
        "id": "dashboards",
        "label": "Дашборды",
        "paragraphs": [
          "Раздел «Дашборды» открывает общий обзор доступных проектов. «Сохранить как свой» создаёт личную редактируемую копию. Менеджер может настроить вкладку «Обзор» своего проекта.",
          "Виджеты показывают здоровье проектов, контрольные даты, числа, разбивки, тренды, списки задач, нагрузку, прогресс и активность. Администратор может опубликовать дашборд для организации; каждый видит только доступные ему данные."
        ]
      },
      {
        "id": "home",
        "label": "Главный экран",
        "paragraphs": [
          "Главная показывает ваши назначенные задачи и проекты. Фильтры помогают найти просроченные задачи и сроки на неделю. Проект можно открыть карточкой, через боковое меню или палитру команд.",
          "Нажмите логотип Taskira, чтобы вернуться на главную. Поиск и палитра находят задачи по названию или ключу; открытие задачи другого проекта переключает проект. Кнопки браузера «Назад» и «Вперёд» восстанавливают навигацию."
        ]
      },
      {
        "id": "hotkeys",
        "label": "Горячие клавиши",
        "paragraphs": [
          "Клавиши работают вне полей ввода. В текстовом поле сохраняются обычные действия браузера. Окно «Горячие клавиши» показывает полный список."
        ],
        "table": {
          "headers": [
            "Действие",
            "Клавиши"
          ],
          "rows": [
            [
              "Поиск по задачам",
              "/"
            ],
            [
              "Создать задачу",
              "C"
            ],
            [
              "Доска, список, таймлайн, спринты, календарь",
              "1 – 5"
            ],
            [
              "Главная, входящие, мои задачи, отчёты, дашборды, обзор, настройки проекта",
              "G → H / I / M / R / D / O / S"
            ],
            [
              "Палитра команд",
              "Ctrl + K"
            ],
            [
              "Все сочетания",
              "?"
            ],
            [
              "Закрыть окно / выйти из выделения",
              "Esc"
            ],
            [
              "Отправить комментарий",
              "Ctrl + Enter"
            ]
          ]
        }
      },
      {
        "id": "model",
        "label": "Модель данных",
        "paragraphs": [
          "Команда объединяет проекты; проект содержит рабочий процесс и задачи. Участник проекта получает роль именно в этом проекте. Пользователь может иметь разные роли в разных проектах.",
          "Исполнители, приглашённые участники и наблюдатели задачи — разные связи. Направление и родитель подзадачи ссылаются на обычные задачи, но решают разные задачи планирования."
        ],
        "table": {
          "headers": [
            "Сущность",
            "Поля",
            "Назначение"
          ],
          "rows": [
            [
              "Project",
              "key, name, departmentId",
              "Команда, участники, статусы и задачи"
            ],
            [
              "User / ProjectMember",
              "globalRole / projectRole",
              "Роль организации и роль в проекте"
            ],
            [
              "Issue",
              "type, status, priority, assigneeIds, reporter, dueDate",
              "Описание, метки, поля, файлы, обсуждение и история"
            ],
            [
              "Direction / Subtask",
              "epicId / parentId",
              "Группировка по цели / часть родительской задачи"
            ],
            [
              "Collaborator / Watcher",
              "issueId, userId",
              "Приглашение к задаче / подписка на события"
            ],
            [
              "IssueLink / Checklist",
              "linkedIssueId / text, done",
              "Отношение задач / небольшие шаги"
            ],
            [
              "CustomField / IssueTemplate",
              "projectId, configuration",
              "Поля проекта / заготовки для формы создания"
            ],
            [
              "Sprint / Milestone",
              "status, goal / date, name",
              "Период работы / контрольная дата результата"
            ],
            [
              "Attachment / Notification",
              "issueId / userId",
              "Файлы задачи / уведомления пользователя"
            ]
          ]
        }
      },
      {
        "id": "storage",
        "label": "Хранение и сессия",
        "paragraphs": [
          "Задачи и настройки организации хранятся на сервере. Сессия использует защищённую HttpOnly-cookie; выход отзывает её на сервере. Проверка прав выполняется при запросах, а не только скрытием кнопок.",
          "Язык, тема и другие настройки интерфейса сохраняются в браузере. Личное фото доски хранится в IndexedDB отдельно для пользователя и проекта, не загружается на сервер и удаляется при очистке данных браузера."
        ]
      },
      {
        "id": "planning",
        "label": "Планирование: что для чего",
        "paragraphs": []
      },
      {
        "id": "calendar",
        "label": "Календарь",
        "paragraphs": [
          "Календарь показывает задачи по срокам в месяце или неделе. Перетаскивание задачи на дату меняет срок, а перенос в «Без срока» снимает его — при наличии права редактировать задачу.",
          "Клавиша 5 открывает календарь. Клавиша M на задаче вызывает выбор срока. Календарь не создаёт отдельную копию задачи и не заменяет даты направлений на таймлайне."
        ]
      },
      {
        "id": "templates",
        "label": "Шаблоны и создание проектов",
        "paragraphs": [
          "Администратор создаёт проект, выбирает команду, ключ, название и шаблон. Встроенный или сохранённый шаблон задаёт статусы, переходы, поля, заготовки задач, предлагаемые метки и стартовый вид.",
          "Проект можно сохранить как шаблон для повторного использования настроек. Это не копирование задач, файлов или участников. Шаблон задачи отдельно предзаполняет форму создания и не связывает созданную задачу с шаблоном."
        ]
      },
      {
        "id": "appearance",
        "label": "Оформление и фотографии",
        "paragraphs": [
          "Администратор задаёт название, знак и цвет бренда для организации. Новые цвета проверены на читаемость во всех темах. Цвет не меняет права, задачи, статусы или их смысл.",
          "Создатель выбирает общее оформление проекта. Личная тема интерфейса выбирается в ваших настройках. На доске кнопка «Фото моей доски» добавляет изображение только за колонками, только для вашего пользователя и проекта в этом браузере.",
          "Личный фон можно заменить или удалить; поддерживаются PNG, JPG/JPEG, GIF и WebP до 20 МБ. Если обработка или сохранение не удалось, показывается ошибка, а прежнее фото сохраняется.",
          "Для аватара разрешены только исходные файлы PNG, JPG/JPEG и GIF. Выбор другого расширения отклоняется до обработки. Фото обрезается до квадрата и отправляется как JPEG; сервер повторно проверяет тип и размер, по умолчанию до 3 МБ."
        ]
      }
    ],
    "permission": "Разрешение"
  },
  "en": {
    "title": "Taskira documentation",
    "subtitle": "Projects, issues, planning and settings",
    "sections": [
      {
        "id": "overview",
        "label": "System overview",
        "paragraphs": [
          "Taskira brings projects and issues together. Board, list, calendar and timeline show the same work in different ways; an issue change appears in every view.",
          "Start by selecting a project and creating an issue. The board groups issues by status; the list supports searching and bulk actions, the calendar shows due dates, and the timeline shows directions.",
          "Organization settings, teams, project creation and workflow management are available to administrators. The interface explains unavailable actions; the server makes the final access decision."
        ]
      },
      {
        "id": "roles",
        "label": "Roles and permissions",
        "paragraphs": [
          "Roles are assigned per project: manager, employee or viewer. A global administrator can access every project. Visibility through a team or shared access does not grant permission to change project settings.",
          "Employees edit and move issues where they are the reporter or an assignee. Viewers read issues. An invitation to an issue grants access to that issue and its discussion, without making the person a member of the whole project.",
          "The table below shows role permissions. Issue actions also consider the reporter, assignees and invited collaborators; available buttons can differ between two people with the same role."
        ]
      },
      {
        "id": "workflow",
        "label": "Workflow",
        "paragraphs": [
          "Workflow defines project statuses and allowed transitions. The todo, in-progress and done categories determine their meaning and are used in reports, progress and sprint completion.",
          "Both board and issue details enforce allowed transitions and issue permissions. The server rejects forbidden moves. Status names can differ between projects.",
          "Administrators configure workflow, custom fields and issue templates. These changes apply to the project; managers organize work but cannot change its workflow schema."
        ]
      },
      {
        "id": "issues",
        "label": "Issue details",
        "paragraphs": [
          "An issue holds its title, description, type, priority, status, due date, complexity, labels, reporter, assignees, direction, subtasks, links, checklist, custom fields, attachments, comments and activity. User-entered text is not translated.",
          "An issue can have several assignees or none. Assignee search shows project members; a former member who is still assigned can be removed. An invited collaborator participates in one issue and is separate from its assignees.",
          "A subtask has its own status and due date; nesting has two levels, with no subtasks below a subtask. A checklist has up to 50 small steps without separate assignees. Custom fields can be text, number, select, checkbox or date.",
          "Priority indicates importance; complexity estimates difficulty. Related-to, blocks and blocked-by links describe relationships and do not automatically change status or due dates. See the planning section for examples."
        ]
      },
      {
        "id": "list",
        "label": "Issue list",
        "paragraphs": [
          "The issue list is a table with search, sorting and filters for status, assignee, type, priority, label, due dates, sprint, overdue work and a custom field. Filter conditions are stored in the address bar.",
          "Save a filter under a name and choose it as your default view. Sort by priority, due date, update time or key; the visible page does not limit the number of project issues.",
          "Select enables bulk status, assignee and priority changes or deletion, with permission checks for each issue. Import supports the Trello, Jira and Asana formats listed in the import dialog; review the preview before confirming."
        ]
      },
      {
        "id": "sprints",
        "label": "Sprints",
        "paragraphs": [
          "Sprints are an optional project module enabled by an administrator in settings. Without them, use the board and list. Managers and administrators create, start and complete sprints.",
          "A sprint is future, active or completed. Only one sprint can be active per project. Its goal explains the expected result, and authorized users can change its issue scope.",
          "On completion, unfinished issues return to the backlog; completed issues remain in the finished sprint. Issues are not automatically moved to the next sprint."
        ]
      },
      {
        "id": "notifications",
        "label": "Notifications",
        "paragraphs": [
          "Inbox shows notifications about assignments, comments, mentions, status changes, invitations and membership. Your own actions normally do not notify you.",
          "Recipients depend on the event and issue access: reporter, assignees, watchers or collaborators. A @username mention notifies a person if they can access the issue.",
          "Personal settings control notifications, automatic watching and email delivery: instant or digest. Email requires server mail configuration and a user email address."
        ]
      },
      {
        "id": "attachments",
        "label": "Attachments",
        "paragraphs": [
          "Users with comment permission upload files in issue details. Defaults are up to 50 files, each up to 25 MB; the server can configure different limits.",
          "The uploader or a user with issue-delete permission can remove an attachment. The server validates file type and size, and downloads require access to the issue.",
          "Files are kept on server disk or configured S3-compatible storage. Uploading and downloading work the same way for users. Profile photos have separate restrictions; see Appearance."
        ]
      },
      {
        "id": "departments",
        "label": "Teams and LDAP",
        "paragraphs": [
          "A project is visible to global administrators, its explicit members, members of its team, or everyone when it is shared. Visibility and modification rights are different; roles are assigned separately.",
          "In LDAP/AD mode, directory groups can determine team membership. Administrators link teams to groups and can resynchronize; manual membership is preserved and managed separately.",
          "The greeting uses the directory givenName. Login and resynchronization update it; an empty resync response preserves a previously saved name. If the given name is unknown, the full name is shown without guessing name order."
        ]
      },
      {
        "id": "reports",
        "label": "Reports",
        "paragraphs": [
          "Reports show created, completed, open and overdue issues and completion time for a selected period. Use filters to compare the relevant work.",
          "Group data by project, assignee, type or priority and export it as CSV. Reports use data available to the user and do not grant access to another project."
        ]
      },
      {
        "id": "dashboards",
        "label": "Dashboards",
        "paragraphs": [
          "Dashboards opens an overview of accessible projects. Save as my own creates a personal editable copy. A manager can arrange their project Overview tab.",
          "Widgets show project health, milestones, numbers, breakdowns, trends, issue lists, workload, progress and activity. Administrators can publish a dashboard for the organization; each user sees only data they can access."
        ]
      },
      {
        "id": "home",
        "label": "Home",
        "paragraphs": [
          "Home shows your assigned issues and projects. Filters find overdue work and due dates within a week. Open a project from its card, sidebar or command palette.",
          "Click the Taskira logo to return home. Search and the command palette find issues by title or key; opening an issue from another project switches projects. Browser Back and Forward restore navigation."
        ]
      },
      {
        "id": "hotkeys",
        "label": "Keyboard shortcuts",
        "paragraphs": [
          "Shortcuts operate outside editable fields. Text fields retain normal browser typing behavior. The Keyboard shortcuts dialog shows the full list."
        ],
        "table": {
          "headers": [
            "Action",
            "Keys"
          ],
          "rows": [
            [
              "Search issues",
              "/"
            ],
            [
              "Create issue",
              "C"
            ],
            [
              "Board, list, timeline, sprints, calendar",
              "1 – 5"
            ],
            [
              "Home, inbox, my issues, reports, dashboards, overview, project settings",
              "G → H / I / M / R / D / O / S"
            ],
            [
              "Command palette",
              "Ctrl + K"
            ],
            [
              "All shortcuts",
              "?"
            ],
            [
              "Close dialog / leave selection",
              "Esc"
            ],
            [
              "Send comment",
              "Ctrl + Enter"
            ]
          ]
        }
      },
      {
        "id": "model",
        "label": "Data model",
        "paragraphs": [
          "A team groups projects; a project contains workflow and issues. Project membership assigns a role in that project. A user can have different roles in different projects.",
          "Assignees, collaborators and watchers are different issue relationships. A direction and a subtask parent refer to ordinary issues but serve different planning purposes."
        ],
        "table": {
          "headers": [
            "Entity",
            "Fields",
            "Purpose"
          ],
          "rows": [
            [
              "Project",
              "key, name, departmentId",
              "Team, members, statuses and issues"
            ],
            [
              "User / ProjectMember",
              "globalRole / projectRole",
              "Organization role and project role"
            ],
            [
              "Issue",
              "type, status, priority, assigneeIds, reporter, dueDate",
              "Description, labels, fields, files, discussion and activity"
            ],
            [
              "Direction / Subtask",
              "epicId / parentId",
              "Grouping by goal / a piece of a parent issue"
            ],
            [
              "Collaborator / Watcher",
              "issueId, userId",
              "Issue invitation / watching issue events"
            ],
            [
              "IssueLink / Checklist",
              "linkedIssueId / text, done",
              "Issue relationship / small steps"
            ],
            [
              "CustomField / IssueTemplate",
              "projectId, configuration",
              "Project fields / pre-filled issue forms"
            ],
            [
              "Sprint / Milestone",
              "status, goal / date, name",
              "Work period / result checkpoint date"
            ],
            [
              "Attachment / Notification",
              "issueId / userId",
              "Issue files / user notifications"
            ]
          ]
        }
      },
      {
        "id": "storage",
        "label": "Storage and sessions",
        "paragraphs": [
          "Issues and organization settings are stored on the server. Sessions use a protected HttpOnly cookie; logout revokes them server-side. Requests enforce permissions rather than relying on hidden buttons.",
          "Language, theme and interface preferences are saved in the browser. Your board photo is stored in IndexedDB per account and project, is not uploaded to the server, and is removed when browser data is cleared."
        ]
      },
      {
        "id": "planning",
        "label": "Planning: which tool to use",
        "paragraphs": []
      },
      {
        "id": "calendar",
        "label": "Calendar",
        "paragraphs": [
          "Calendar shows issues by due date in month or week view. Dragging an issue to a date changes its due date; moving it to No due date clears it, subject to issue-edit permission.",
          "Press 5 to open Calendar. Press M on an issue to choose its due date. Calendar does not create a duplicate issue or replace direction dates on the timeline."
        ]
      },
      {
        "id": "templates",
        "label": "Templates and project creation",
        "paragraphs": [
          "An administrator creates a project, choosing its team, key, name and template. A built-in or saved template supplies statuses, transitions, fields, issue templates, suggested labels and the initial view.",
          "Save a project as a template to reuse its configuration. It does not copy issues, files or members. An issue template separately pre-fills issue creation and does not link the resulting issue back to the template."
        ]
      },
      {
        "id": "appearance",
        "label": "Appearance and photos",
        "paragraphs": [
          "Administrators choose the organization brand name, logo and accent colour. New colours are checked for readability across themes. Colour does not change permissions, issues, statuses or their meaning.",
          "The creator chooses the project’s shared appearance. Choose your personal interface theme in your settings. My board photo adds an image behind board columns only, for your account and this project in this browser.",
          "Replace or remove your board photo; PNG, JPG/JPEG, GIF and WebP up to 20 MB are supported. If processing or saving fails, an error is shown and the previous photo is retained.",
          "Profile photos accept original PNG, JPG/JPEG and GIF files only. Other extensions are rejected before processing. Photos are cropped square and sent as JPEG; the server checks type and size again, defaulting to 3 MB."
        ]
      }
    ],
    "permission": "Permission"
  }
};
