/** Шаблоны email-уведомлений (NOTIFICATIONS_MIGRATION.md D7/D9).
 *
 *  D9 — ГАРАНТИЯ КОНСТРУКЦИЕЙ: на вход функций подаётся только тип события,
 *  ключ задачи и id для ссылки. Ни заголовка задачи, ни описания, ни текста
 *  комментария здесь нет и физически быть не может — их просто не передают.
 */
import type { NotifyType } from "../contract.js";

const EVENT_RU: Record<NotifyType, string> = {
  "issue.assigned": "вас назначили исполнителем задачи",
  "issue.comment": "новый комментарий к задаче",
  "issue.mention": "вас упомянули в задаче",
  "issue.status": "изменился статус задачи",
  "issue.collaborator": "вас подключили к задаче",
  "project.member": "вас добавили в проект",
};

/** Всё, что нужно шаблону. Задачного контента тут нет (D9). */
export interface MailItem {
  type: NotifyType;
  /** CORP-123 для issue.* ; для project.member — undefined. */
  issueKey?: string | null;
  projectId: string | null;
  issueId: string | null;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Ссылка на задачу (или на приложение, если задачи нет — project.member). */
function link(appBaseUrl: string, it: MailItem): string {
  const base = appBaseUrl.replace(/\/+$/, "");
  if (it.issueId && it.projectId) return `${base}/#/issue/${it.projectId}/${it.issueId}`;
  return `${base}/#/`;
}

const FOOTER_TEXT =
  "Это письмо не содержит текста задачи — подробности внутри Taskira.\n" +
  "Режим уведомлений (сразу / дайджест / выкл) — в настройках приложения.";
const FOOTER_HTML =
  '<p style="color:#8b95a7;font-size:12px;margin-top:16px">' +
  "Письмо не содержит текста задачи — подробности внутри Taskira. " +
  "Режим уведомлений — в настройках приложения.</p>";

/** Одно событие. */
export function renderOne(appBaseUrl: string, it: MailItem): RenderedMail {
  const ev = EVENT_RU[it.type];
  const ref = it.issueKey ? ` ${it.issueKey}` : "";
  const url = link(appBaseUrl, it);
  return {
    subject: `Taskira · ${ev}${ref}`,
    text: `${ev}${ref}.\n\nОткрыть: ${url}\n\n${FOOTER_TEXT}\n`,
    html:
      `<p>${esc(ev)}${esc(ref)}.</p>` +
      `<p><a href="${esc(url)}">Открыть в Taskira</a></p>` +
      FOOTER_HTML,
  };
}

/** Дайджест: одно письмо со списком ссылок, сгруппированных по типу события. */
export function renderDigest(appBaseUrl: string, items: MailItem[]): RenderedMail {
  const byType = new Map<NotifyType, MailItem[]>();
  for (const it of items) {
    const arr = byType.get(it.type) ?? [];
    arr.push(it);
    byType.set(it.type, arr);
  }

  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  for (const [type, group] of byType) {
    const head = EVENT_RU[type];
    textBlocks.push(
      `${head}:\n` + group.map((it) => `  ${it.issueKey ?? "проект"} — ${link(appBaseUrl, it)}`).join("\n"),
    );
    htmlBlocks.push(
      `<p><b>${esc(head)}</b></p><ul>` +
        group
          .map((it) => `<li>${esc(it.issueKey ?? "проект")} — <a href="${esc(link(appBaseUrl, it))}">открыть</a></li>`)
          .join("") +
        `</ul>`,
    );
  }

  return {
    subject: `Taskira · сводка уведомлений (${items.length})`,
    text: `Сводка уведомлений — ${items.length} шт.\n\n${textBlocks.join("\n\n")}\n\n${FOOTER_TEXT}\n`,
    html: `<p>Сводка уведомлений — ${items.length} шт.</p>${htmlBlocks.join("")}${FOOTER_HTML}`,
  };
}
