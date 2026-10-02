export function planningCopy(lang: "ru" | "en") {
  const en = lang === "en";
  const rows = en ? [
    ["Roadmap", "A plan across projects: Employee portal, Knowledge base. It shows how the projects fit together."],
    ["Milestone", "A checkpoint date, not a task or a time span: 15 November — pilot launch. Agree the result expected by that date; track the actual work in issues."],
    ["Direction", "A shared goal inside a project, such as Sign-in. Create a normal issue for that goal and select it in other issues' Direction field. It becomes a direction when another issue refers to it."],
    ["Timeline", "A time-based view of the project's directions and their progress. It answers when Sign-in and Employee profiles are planned; it does not create duplicate work."],
    ["Subtask", "A separate piece of one issue, with its own assignees, status and due date. For Add LDAP sign-in, create Configure directory and Test sign-in. Use a subtask when a piece needs independent tracking."],
    ["Linked issue", "A connection between separate issues. Configure directory blocks Test sign-in; Update help relates to Add LDAP sign-in. A link does not make one issue a child or automatically move its dates or status."],
    ["Checklist", "Small steps inside one issue: check the error message, check logout. Use these when a separate assignee, status and due date are unnecessary."],
  ] : [
    ["Роадмап", "План по проектам: «Портал сотрудников», «База знаний». Показывает, как проекты укладываются в общий план."],
    ["Веха (контрольная дата)", "Важная дата проверки результата, а не задача и не отрезок времени: «15 ноября — пилотный запуск». Договоритесь, что должно быть готово к этой дате, а саму работу ведите в задачах."],
    ["Направление", "Общая цель внутри проекта, например «Вход в систему». Создайте для неё обычную задачу и выберите её в поле «Направление» у других задач. Направление появляется, когда на задачу ссылается хотя бы одна другая."],
    ["Таймлайн", "Вид направлений проекта по времени с их прогрессом. Отвечает, когда запланированы «Вход в систему» и «Профили сотрудников». Это другое представление работы, а не новые задачи."],
    ["Подзадача", "Самостоятельная часть одной задачи со своим исполнителем, статусом и сроком. Для «Добавить вход через LDAP» создайте «Настроить каталог» и «Проверить вход». Подзадача нужна, если часть работы надо отслеживать отдельно."],
    ["Связанная задача", "Связь между отдельными задачами: «Настроить каталог» блокирует «Проверить вход»; «Обновить справку» связана с «Добавить вход через LDAP». Связь не делает задачу дочерней и сама не переносит сроки или статус."],
    ["Чек-лист", "Мелкие шаги внутри задачи: проверить текст ошибки, проверить выход. Подходит, когда шагу не нужны отдельный исполнитель, статус и срок."],
  ];
  return { rows,
    intro: en ? "Example: the Employee portal project. Choose a tool by the question you need to answer; you do not need to use every tool." : "Пример: проект «Портал сотрудников». Выбирайте инструмент по вопросу, на который хотите ответить. Использовать всё сразу не обязательно.",
    summary: en ? "Start with a board and issues. Add a checklist for small steps, subtasks for separately owned work, a direction for a shared goal, links for dependencies, a timeline for scheduling, and milestones for checkpoint dates." : "Начните с доски и задач. Добавляйте чек-лист для мелких шагов, подзадачи для самостоятельных работ, направление для общей цели, связи для зависимостей, таймлайн для планирования по времени, а вехи — для контрольных дат.",
    photo: en ? "Personal board photo: open My board photo on the board. Your choice is stored in this browser for your account and this project. It does not change the project theme or other people's boards. Clearing browser data removes the photo." : "Личное фото: на доске откройте «Фото моей доски». Выбор хранится в этом браузере для вашего пользователя и проекта. Он не меняет тему проекта или доски других людей. Очистка данных браузера удалит фото.",
  };
}
