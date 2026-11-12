import type { Lang } from "../i18n";
import type { ApplicationId } from "../../server/src/applicationContract";

type ApplicationCopy = {
  apps: Record<ApplicationId, { name: string; purpose: string; start: string }>;
  switcher: string; applications: string; home: string; projects: string;
  recent: string; search: string; noProjects: string; noProjectsHint: string;
  noMaterials: string; noMaterialsHint: string; noResults: string; noResultsHint: string; retry: string; loading: string; loadError: string;
  settingsHint: string; disabledHint: string; projectHint: string; saving: string; saved: string;
  unavailable: string; unavailableHint: string; manage: string; readOnly: string;
};
const ru: ApplicationCopy = {
  apps: {
    work: { name: "Работа", purpose: "Задачи, процессы и планы", start: "Организуйте работу, выполняйте задачи и следите за результатом." },
    knowledge: { name: "Знания", purpose: "Документы и инструкции", start: "Находите инструкции, готовьте документы вместе и поддерживайте их актуальность." },
    objects: { name: "Объекты", purpose: "Реестры и история объектов", start: "Ведите сведения о системах, оборудовании и других объектах вместе с историей работы." },
  },
  switcher: "Переключить приложение", applications: "Приложения", home: "Главная приложения",
  projects: "Проекты приложения", recent: "Материалы", search: "Найти материал",
  noProjects: "В приложении пока нет проектов", noProjectsHint: "Менеджер проекта может включить соответствующий модуль в настройках проекта.",
  noMaterials: "Материалов пока нет", noMaterialsHint: "Откройте проект, чтобы создать первый материал. Здесь появятся доступные вам документы и записи.",
  noResults: "Материалы не найдены", noResultsHint: "Попробуйте изменить поисковый запрос.",
  retry: "Повторить", loading: "Загрузка приложений…", loadError: "Не удалось загрузить приложения",
  settingsHint: "Подключите приложения, которые нужны организации. Каждое приложение имеет свою навигацию. Доступ к проектам остаётся прежним.",
  disabledHint: "Отключённое приложение исчезает из меню. Его материалы доступны по прямым ссылкам для чтения и экспорта, изменения останавливаются. При отключении «Работы» новые этапы процессов не запускаются.",
  projectHint: "Документы и объекты дополнительно включаются для каждого проекта в разделе «Модули». Файлы проекта доступны из всех приложений.",
  saving: "Сохраняем настройки приложений…", saved: "Настройки приложений сохранены", unavailable: "Приложение отключено",
  unavailableHint: "Материалы можно читать и экспортировать по прямым ссылкам. Для продолжения работы администратор должен включить приложение.",
  manage: "Управлять приложениями", readOnly: "Чтение и экспорт",
};
const en: ApplicationCopy = {
  apps: {
    work: { name: "Work", purpose: "Tasks, processes and plans", start: "Organize work, complete tasks and track results." },
    knowledge: { name: "Knowledge", purpose: "Documents and instructions", start: "Find instructions, prepare documents together and keep them current." },
    objects: { name: "Objects", purpose: "Registers and object history", start: "Maintain systems, equipment and other records together with their work history." },
  },
  switcher: "Switch application", applications: "Applications", home: "Application home",
  projects: "Application projects", recent: "Materials", search: "Find material",
  noProjects: "No projects in this application yet", noProjectsHint: "A project manager can enable the corresponding module in project settings.",
  noMaterials: "No materials yet", noMaterialsHint: "Open a project to create the first material. Available documents and records will appear here.",
  noResults: "No matching materials", noResultsHint: "Try changing the search query.",
  retry: "Retry", loading: "Loading applications…", loadError: "Could not load applications",
  settingsHint: "Connect the applications your organization needs. Each application has its own navigation. Existing project access still applies.",
  disabledHint: "A disabled application disappears from the menu. Its materials remain readable and exportable through direct links; editing stops. Disabling Work also stops new process steps.",
  projectHint: "Documents and objects must also be enabled in each project's Modules settings. Project files are accessible from every application.",
  saving: "Saving application settings…", saved: "Application settings saved", unavailable: "Application disabled",
  unavailableHint: "Materials remain readable and exportable through direct links. An administrator must enable the application to continue working.",
  manage: "Manage applications", readOnly: "Read and export",
};
export const applicationsCopy = (lang: Lang): ApplicationCopy => lang === "en" ? en : ru;
