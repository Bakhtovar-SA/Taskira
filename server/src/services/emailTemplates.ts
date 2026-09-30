/** Шаблоны email-уведомлений (NOTIFICATIONS_MIGRATION.md D7/D9).
 *
 *  D9 — ГАРАНТИЯ КОНСТРУКЦИЕЙ: на вход функций подаётся только тип события,
 *  ключ задачи и id для ссылки. Ни заголовка задачи, ни описания, ни текста
 *  комментария здесь нет и физически быть не может — их просто не передают.
 */
import type { Lang, NotifyType } from "../contract.js";

/** Строки писем на двух языках (трек E). Форма одна — `MailStrings`; тест сверяет, что у обоих языков заполнено всё. */
export interface MailStrings {
  events: Record<NotifyType, string>;
  open: string;
  openLabel: string;
  project: string;
  footerText: string;
  footerHtml: string;
  digestHead: (n: number) => string;
  digestSubject: (n: number) => string;
}

export const MAIL_STRINGS: Record<Lang, MailStrings> = {
  ru: {
    events: {
      "issue.assigned": "вас назначили исполнителем задачи",
      "issue.comment": "новый комментарий к задаче",
      "issue.mention": "вас упомянули в задаче",
      "issue.status": "изменился статус задачи",
      "issue.collaborator": "вас подключили к задаче",
      "project.member": "вас добавили в проект",
    },
    open: "Открыть",
    openLabel: "Открыть в Taskira",
    project: "проект",
    footerText: "Это письмо не содержит текста задачи — подробности внутри Taskira.\nРежим уведомлений (сразу / дайджест) — в настройках приложения.",
    footerHtml: "Письмо не содержит текста задачи — подробности внутри Taskira.<br />Режим уведомлений — в настройках приложения.",
    digestHead: (n) => `Сводка уведомлений — ${n} шт.`,
    digestSubject: (n) => `сводка уведомлений (${n})`,
  },
  en: {
    events: {
      "issue.assigned": "you were assigned to an issue",
      "issue.comment": "new comment on an issue",
      "issue.mention": "you were mentioned in an issue",
      "issue.status": "an issue changed status",
      "issue.collaborator": "you were invited to an issue",
      "project.member": "you were added to a project",
    },
    open: "Open",
    openLabel: "Open in Taskira",
    project: "project",
    footerText: "This email doesn't include the issue's text — see the details in Taskira.\nNotification mode (instant / digest) is in the app settings.",
    footerHtml: "This email doesn't include the issue's text — see the details in Taskira.<br />Notification mode is in the app settings.",
    digestHead: (n) => `Notification digest — ${n}`,
    digestSubject: (n) => `notification digest (${n})`,
  },
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

/** Корень приложения (без хэш-маршрута к конкретной задаче). */
function appUrl(appBaseUrl: string): string {
  return `${appBaseUrl.replace(/\/+$/, "")}/#/`;
}

/** Ссылка на задачу (или на приложение, если задачи нет — project.member). */
function link(appBaseUrl: string, it: MailItem): string {
  if (it.issueId && it.projectId) return `${appBaseUrl.replace(/\/+$/, "")}/#/issue/${it.projectId}/${it.issueId}`;
  return appUrl(appBaseUrl);
}

/** Брендовый акцент — тот же #0B5FD9, что --c-accent (src/index.css) и цвет
 *  аватарки новых LDAP-пользователей (userProvisioning.ts). Захардкожен, а не
 *  взят из CSS-переменной — почтовые клиенты не читают внешние стили и css
 *  vars, вся вёрстка письма инлайновая. */
const BRAND = "#0B5FD9";

/** card-класс, единый для обоих шаблонов ниже — по нему notifier.test.ts
 *  проверяет, что карточная вёрстка действительно на месте, не только текст. */
const CARD_MARKER = "taskira-email-card";

/** Оборачивает готовый HTML-фрагмент (уже экранированный вызывающей стороной)
 *  в table-based карточку — table, а не div/flex, ради предсказуемого рендера
 *  в Outlook и прочих почтовых клиентах, не понимающих современный CSS.
 *  D9: сюда попадает только то, что renderOne/renderDigest уже собрали из
 *  MailItem (тип/ключ/ссылка) — ни заголовка, ни текста задачи здесь нет и
 *  быть не может, эта функция ничего не знает про issue помимо готовой разметки. */
function wrapCard(preheader: string, bodyHtml: string, ctaUrl: string, m: MailStrings, lang: Lang): string {
  return `<!doctype html>
<html lang="${lang}">
  <body style="margin:0;padding:24px 12px;background:#f1f3f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="${CARD_MARKER}">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fdfdfe;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(23,35,59,0.08);">
            <tr>
              <td style="background:${BRAND};padding:18px 28px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;letter-spacing:0.2px;">Taskira</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 28px 20px;color:#17233b;font-size:14px;line-height:1.55;">
                ${bodyHtml}
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:20px;">
                  <tr>
                    <td style="border-radius:8px;background:${BRAND};">
                      <a href="${esc(ctaUrl)}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-size:13.5px;font-weight:600;text-decoration:none;">${esc(m.openLabel)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:14px 28px 20px;border-top:1px solid #e7eaf1;color:#8b95a7;font-size:11.5px;line-height:1.5;">
                ${m.footerHtml}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Одно событие. */
export function renderOne(appBaseUrl: string, it: MailItem, lang: Lang = "ru"): RenderedMail {
  const m = MAIL_STRINGS[lang];
  const ev = m.events[it.type];
  const ref = it.issueKey ? ` ${it.issueKey}` : "";
  const url = link(appBaseUrl, it);
  const bodyHtml = `<p style="margin:0;font-size:15px;">${esc(ev)}${esc(ref)}.</p>`;
  return {
    subject: `Taskira · ${ev}${ref}`,
    text: `${ev}${ref}.\n\n${m.open}: ${url}\n\n${m.footerText}\n`,
    html: wrapCard(`${ev}${ref}`, bodyHtml, url, m, lang),
  };
}

/** Дайджест: одно письмо со списком ссылок, сгруппированных по типу события. */
export function renderDigest(appBaseUrl: string, items: MailItem[], lang: Lang = "ru"): RenderedMail {
  const m = MAIL_STRINGS[lang];
  const byType = new Map<NotifyType, MailItem[]>();
  for (const it of items) {
    const arr = byType.get(it.type) ?? [];
    arr.push(it);
    byType.set(it.type, arr);
  }

  const textBlocks: string[] = [];
  const htmlBlocks: string[] = [];
  for (const [type, group] of byType) {
    const head = m.events[type];
    textBlocks.push(`${head}:\n` + group.map((it) => `  ${it.issueKey ?? m.project} — ${link(appBaseUrl, it)}`).join("\n"));
    htmlBlocks.push(
      `<p style="margin:14px 0 4px;font-weight:700;">${esc(head)}</p>` +
        `<ul style="margin:0;padding-left:18px;">` +
        group
          .map(
            (it) =>
              `<li style="margin-bottom:4px;"><a href="${esc(link(appBaseUrl, it))}" style="color:${BRAND};text-decoration:none;">${esc(it.issueKey ?? m.project)}</a></li>`,
          )
          .join("") +
        `</ul>`,
    );
  }

  const head = m.digestHead(items.length);
  const bodyHtml = `<p style="margin:0 0 4px;font-size:15px;">${esc(head)}</p>${htmlBlocks.join("")}`;
  return {
    subject: `Taskira · ${m.digestSubject(items.length)}`,
    text: `${head}\n\n${textBlocks.join("\n\n")}\n\n${m.footerText}\n`,
    html: wrapCard(head, bodyHtml, appUrl(appBaseUrl), m, lang),
  };
}
