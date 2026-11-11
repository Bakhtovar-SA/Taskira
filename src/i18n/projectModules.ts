import type { Lang } from "../i18n";
import type { WorkspaceModules } from "../../server/src/workspaceContract";

export const MODULE_IDS = [
  "documents",
  "objects",
  "processes",
  "planning",
  "files",
] as const satisfies readonly (keyof WorkspaceModules)[];
type ModuleDescription = { name: string; purpose: string; example: string };
type ModulesCopy = {
  modules: Record<(typeof MODULE_IDS)[number], ModuleDescription>;
  settings: string;
  loading: string;
  retry: string;
  saving: string;
  saved: string;
  readOnly: string;
  disabled: string;
  filesDisabled: string;
};
const ru: ModulesCopy = {
  settings: "Настроить модули",
  loading: "Загрузка модулей…",
  retry: "Повторить",
  saving: "Сохраняем…",
  saved: "Изменения сохранены",
  readOnly:
    "Модули рабочего пространства включает менеджер или администратор проекта. Спринтами управляет администратор.",
  disabled:
    "При отключении вкладка скрывается, а документы, объекты, процессы и планы сохраняются для чтения и экспорта по прямым ссылкам. Изменения и новые этапы останавливаются. После включения работа снова доступна; приостановленный процесс нужно возобновить вручную.",
  filesDisabled:
    "Отключение «Файлов» скрывает общий каталог. Вложения остаются в исходных задачах и документах; их можно открывать и добавлять там по прежним правам.",
  modules: {
    documents: {
      name: "Документы",
      purpose:
        "Инструкции, требования, решения и результаты: совместный редактор, комментарии, версии и подтверждение актуальности.",
      example:
        "Например, подготовить регламент вместе с коллегами и создать задачи из его пунктов.",
    },
    objects: {
      name: "Объекты",
      purpose:
        "Реестры систем, сервисов, оборудования или договоров. Карточка объединяет свойства, ответственного и связанную работу.",
      example:
        "Например, открыть систему и найти все её проверки, замечания и инструкции.",
    },
    processes: {
      name: "Процессы",
      purpose:
        "Повторяемая работа по шаблону: этапы, зависимости, исполнители, условия, подтверждение результата и автоматизации.",
      example:
        "Например, провести проверку, устранить замечания и получить подтверждение повторной проверки.",
    },
    planning: {
      name: "Планирование",
      purpose:
        "Состав и приоритеты работы, нагрузка по людям и сложности, прогноз по истории завершённых задач и сравнение вариантов плана.",
      example:
        "Например, оценить, как срочная задача повлияет на текущие сроки. Учёт часов не нужен.",
    },
    files: {
      name: "Файлы",
      purpose:
        "Общий каталог вложений всех задач и документов проекта, включая архивные материалы: поиск, фильтры и скачивание.",
      example:
        "Например, найти протокол проверки и перейти к задаче или документу, где его добавили.",
    },
  },
};
const en: ModulesCopy = {
  settings: "Configure modules",
  loading: "Loading modules…",
  retry: "Retry",
  saving: "Saving…",
  saved: "Changes saved",
  readOnly:
    "A project manager or administrator can configure workspace modules. Sprints are managed by an administrator.",
  disabled:
    "Disabling a module hides its tab. Documents, objects, processes and plans remain readable and exportable through direct links. Changes and new steps stop. Enabling restores editing; a paused process must be resumed manually.",
  filesDisabled:
    "Disabling Files hides the shared catalogue. Attachments remain in their original tasks and documents, where existing permissions still allow reading and uploading.",
  modules: {
    documents: {
      name: "Documents",
      purpose:
        "Instructions, requirements, decisions and results with collaborative editing, comments, versions and verification.",
      example:
        "For example, prepare a policy together and create tasks from its sections.",
    },
    objects: {
      name: "Objects",
      purpose:
        "Registers of systems, services, equipment or contracts. A record brings together properties, ownership and related work.",
      example:
        "For example, open a system to find its reviews, findings and instructions.",
    },
    processes: {
      name: "Processes",
      purpose:
        "Repeatable work from templates with steps, dependencies, assignees, conditions, result approval and automation.",
      example:
        "For example, review a system, fix findings and get the follow-up review approved.",
    },
    planning: {
      name: "Planning",
      purpose:
        "Work scope and priorities, workload by person and complexity, forecasts from completion history and plan comparisons.",
      example:
        "For example, assess how an urgent task affects current dates. Time tracking is not required.",
    },
    files: {
      name: "Files",
      purpose:
        "A shared catalogue of all project task and document attachments, including archived materials, with search, filters and downloads.",
      example:
        "For example, find a review report and open the task or document where it was uploaded.",
    },
  },
};
export const projectModulesCopy = (lang: Lang): ModulesCopy =>
  lang === "en" ? en : ru;
