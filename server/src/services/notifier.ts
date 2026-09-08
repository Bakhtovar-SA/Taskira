/** Фоновый воркер email-рассылки (NOTIFICATIONS_MIGRATION.md D4).
 *
 *  Идёт по notifications.email_state='pending', группирует по получателю,
 *  шлёт через nodemailer. instant — сразу; daily — ждёт NOTIFY_DIGEST_WINDOW_MS
 *  от первого события, затем одно письмо-сводка. Ретрай через email_tries,
 *  после NOTIFY_EMAIL_MAX_TRIES → 'failed'.
 *
 *  MVP — один воркер в основном процессе. Перекрытие тиков исключено re-entrancy
 *  guard'ом (`running`); окно «упал между send и UPDATE → повторная отправка на
 *  рестарте» — приемлемо и задокументировано (§5). Несколько процессов —
 *  NOTIFY_WORKER_ENABLED=false на всех, кроме одного (лидер-лок — Фаза 6).
 */
import nodemailer, { type Transporter } from "nodemailer";
import { q } from "../db.js";
import { loadConfig } from "../config.js";
import { renderDigest, renderOne, type MailItem } from "./emailTemplates.js";
import type { NotifyType, NotifyPrefs } from "../contract.js";

interface PendingRow {
  id: string;
  user_id: string;
  type: NotifyType;
  project_id: string | null;
  issue_id: string | null;
  created_at: Date;
  email_tries: number;
  email: string | null;
  notify_prefs: NotifyPrefs | null;
  issue_key: string | null;
}

let transport: Transporter | null = null;
function tx(): Transporter {
  if (transport) return transport;
  const s = loadConfig().notify.smtp;
  if (!s) throw new Error("notifier: SMTP не сконфигурирован");
  transport = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: s.user ? { user: s.user, pass: s.pass ?? "" } : undefined,
  });
  return transport;
}
/** Сброс транспорта — для тестов (смена SMTP между кейсами). */
export function _resetTransport(): void {
  transport = null;
}

export interface NotifierStats {
  users: number;
  sent: number;
  failed: number;
  skipped: number;
  deferred: number;
}

/** Один проход воркера. Экспортируется для тестов и ручного прогона. */
export async function runNotifierOnce(): Promise<NotifierStats> {
  const cfg = loadConfig().notify;
  const stats: NotifierStats = { users: 0, sent: 0, failed: 0, skipped: 0, deferred: 0 };
  if (!cfg.emailEnabled || !cfg.smtp) return stats;

  const rows = await q<PendingRow>(
    `SELECT n.id, n.user_id, n.type, n.project_id, n.issue_id, n.created_at, n.email_tries,
            u.email, u.notify_prefs, i.key AS issue_key
       FROM notifications n
       JOIN users u ON u.id = n.user_id
       LEFT JOIN issues i ON i.id = n.issue_id
      WHERE n.email_state = 'pending'
      ORDER BY n.created_at
      LIMIT 200`,
  );
  if (rows.length === 0) return stats;

  const byUser = new Map<string, PendingRow[]>();
  for (const r of rows) {
    const arr = byUser.get(r.user_id) ?? [];
    arr.push(r);
    byUser.set(r.user_id, arr);
  }

  const now = Date.now();
  for (const group of byUser.values()) {
    stats.users += 1;
    const ids = group.map((r) => r.id);
    const first = group[0];
    const mode = first.notify_prefs?.email ?? (first.email ? "instant" : "off");

    // Защитный отсев (emit это уже делал, но prefs могли поменяться после):
    if (!first.email || mode === "off") {
      await q(`UPDATE notifications SET email_state = 'skipped' WHERE id = ANY($1)`, [ids]);
      stats.skipped += ids.length;
      continue;
    }

    // daily: ждём, пока самому старому событию не исполнится окно дайджеста.
    if (mode === "daily") {
      const oldest = Math.min(...group.map((r) => new Date(r.created_at).getTime()));
      if (now - oldest < cfg.digestWindowMs) {
        stats.deferred += ids.length;
        continue;
      }
    }

    const items: MailItem[] = group.map((r) => ({
      type: r.type,
      issueKey: r.issue_key,
      projectId: r.project_id,
      issueId: r.issue_id,
    }));
    const mail = items.length === 1 ? renderOne(cfg.appBaseUrl!, items[0]) : renderDigest(cfg.appBaseUrl!, items);

    try {
      await tx().sendMail({
        from: cfg.smtp.from,
        to: first.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      await q(`UPDATE notifications SET email_state = 'sent' WHERE id = ANY($1)`, [ids]);
      stats.sent += ids.length;
    } catch (e) {
      console.error("[notifier] отправка не удалась", (e as Error).message);
      await q(
        `UPDATE notifications
            SET email_tries = email_tries + 1,
                email_state = CASE WHEN email_tries + 1 >= $2 THEN 'failed' ELSE 'pending' END
          WHERE id = ANY($1)`,
        [ids, cfg.emailMaxTries],
      );
      const nowFailed = group.filter((r) => r.email_tries + 1 >= cfg.emailMaxTries).length;
      stats.failed += nowFailed;
    }
  }
  return stats;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Запустить периодический прогон. Идемпотентно. */
export function startNotifier(): void {
  if (timer) return;
  const ms = loadConfig().notify.workerIntervalMs;
  timer = setInterval(() => {
    if (running) return; // тики не перекрываются — это и есть «мягкий лок» одного процесса
    running = true;
    runNotifierOnce()
      .catch((e) => console.error("[notifier] тик упал", e))
      .finally(() => {
        running = false;
      });
  }, ms);
  timer.unref?.();
  console.log(`[notifier] воркер email-рассылки запущен (интервал ${ms} мс)`);
}

export function stopNotifier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
