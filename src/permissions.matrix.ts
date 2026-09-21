/* GENERATED from shared/permissions.matrix.json by scripts/generate-permissions.mjs — DO NOT EDIT.
 * Меняйте shared/permissions.matrix.json и запускайте `npm run permissions:generate` (ТЗ 2.2).
 * Одинаковое содержимое лежит в src/ и server/src/: CI (`npm run permissions:check`) падает при расхождении. */

export const ROLE_IDS = ["admin", "manager", "employee", "viewer"] as const;
export type AccessRole = (typeof ROLE_IDS)[number];

export const PERM_IDS = ["browse", "create", "edit", "transition", "delete", "comment", "editWorkflow", "manageAccess", "manageCollaborators", "manageSprints"] as const;
export type PermId = (typeof PERM_IDS)[number];

/** Разрешение → роли, которым оно доступно (уровень задачи для employee сужается в permissions.ts). */
export const MATRIX: Record<PermId, readonly AccessRole[]> = {
  browse: ["admin", "manager", "employee", "viewer"],
  create: ["admin", "manager", "employee"],
  edit: ["admin", "manager", "employee"],
  transition: ["admin", "manager", "employee"],
  delete: ["admin", "manager"],
  comment: ["admin", "manager", "employee"],
  editWorkflow: ["admin"],
  manageAccess: ["admin"],
  manageCollaborators: ["admin", "manager"],
  manageSprints: ["admin", "manager"],
};

export const ROLE_NAMES: Record<AccessRole, string> = {
  admin: "Администратор",
  manager: "Менеджер проекта",
  employee: "Сотрудник",
  viewer: "Наблюдатель",
};

export const ROLE_DESCRIPTIONS: Record<AccessRole, string> = {
  admin: "Полный контроль проекта: схема workflow, права доступа, удаление задач.",
  manager: "Управляет задачами: создание, редактирование и удаление. Не меняет workflow и роли.",
  employee: "Создаёт задачи, двигает по workflow, комментирует. Редактирует только свои (исполнитель или автор).",
  viewer: "Только просмотр: доска, список задач, карточки — без изменений.",
};

export type PermScope = "Проект" | "Задача" | "Схема" | "Пользователи";

export const PERM_META: Record<PermId, { name: string; desc: string; scope: PermScope }> = {
  browse: { name: "Просмотр проекта", desc: "Доска, список задач, карточки, история и комментарии.", scope: "Проект" },
  create: { name: "Создание задач", desc: "Кнопка «Создать», создание задач.", scope: "Задача" },
  edit: { name: "Редактирование задач", desc: "Поля задачи. Для сотрудника — только свои.", scope: "Задача" },
  transition: { name: "Смена статуса", desc: "Перетаскивание и смена статуса в пределах workflow.", scope: "Задача" },
  delete: { name: "Удаление задач", desc: "Удаление задач.", scope: "Задача" },
  comment: { name: "Комментарии", desc: "Добавление комментариев.", scope: "Задача" },
  editWorkflow: { name: "Изменение workflow", desc: "Переходы и сброс схемы.", scope: "Схема" },
  manageAccess: { name: "Управление доступом", desc: "Пользователи и роли (на сервере).", scope: "Пользователи" },
  manageCollaborators: { name: "Подключение к задаче", desc: "Пригласить человека к отдельной задаче (просмотр + комментарии), не добавляя в проект.", scope: "Задача" },
  manageSprints: { name: "Управление спринтами", desc: "Создание, старт и завершение спринтов; перенос задач между бэклогом и спринтом. Только в проектах с включённым модулем спринтов.", scope: "Проект" },
};
