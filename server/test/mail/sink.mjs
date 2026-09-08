/**
 * In-process SMTP-catcher для тестов email-уведомлений без Docker
 * (NOTIFICATIONS_MIGRATION.md Фаза 3). Аналог test/ldap/mock-ldap.mjs.
 *
 * Ловит письма (nodemailer → SMTP), парсит и отдаёт по HTTP:
 *   GET    /   → [{ to, from, subject, text, html, raw }]   (raw — полный RFC822)
 *   DELETE /   → очистить
 *
 * Порты: MAIL_SINK_SMTP (деф. 1025), MAIL_SINK_HTTP (деф. 8025).
 *
 * В CI используется настоящий Mailpit (docker-compose.mail.yml); этот скрипт —
 * локальный fallback, notifier.test.ts поднимает его сам при MAIL_KIND != mailpit.
 */
import { createServer } from "node:http";
import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";

const SMTP_PORT = Number(process.env.MAIL_SINK_SMTP || 1025);
const HTTP_PORT = Number(process.env.MAIL_SINK_HTTP || 8025);

/** @type {{to:string,from:string,subject:string,text:string,html:string,raw:string}[]} */
const box = [];

const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ["STARTTLS"],
  onData(stream, _session, cb) {
    const chunks = [];
    stream.on("data", (c) => chunks.push(c));
    stream.on("end", () => {
      const raw = Buffer.concat(chunks);
      simpleParser(raw)
        .then((mail) => {
          box.push({
            to: (mail.to?.value ?? []).map((a) => a.address).join(", "),
            from: mail.from?.value?.[0]?.address ?? "",
            subject: mail.subject ?? "",
            text: mail.text ?? "",
            html: typeof mail.html === "string" ? mail.html : "",
            raw: raw.toString("utf8"),
          });
          cb();
        })
        .catch((e) => cb(e));
    });
    stream.on("error", (e) => cb(e));
  },
});

const http = createServer((req, res) => {
  if (req.method === "DELETE") {
    box.length = 0;
    res.writeHead(204).end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(box));
});

smtp.listen(SMTP_PORT, "127.0.0.1", () => console.log(`[mail-sink] SMTP  127.0.0.1:${SMTP_PORT}`));
http.listen(HTTP_PORT, "127.0.0.1", () => console.log(`[mail-sink] HTTP  http://127.0.0.1:${HTTP_PORT}`));

const bye = () => {
  smtp.close();
  http.close();
  process.exit(0);
};
process.on("SIGTERM", bye);
process.on("SIGINT", bye);
process.on("message", (m) => m === "shutdown" && bye()); // когда запущен через child_process.fork
