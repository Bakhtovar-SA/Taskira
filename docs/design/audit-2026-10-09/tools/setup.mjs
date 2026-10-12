import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'D:/CodexScratch/Taskira-UI-Audit-20261009';
const runtime = `${root}-runtime`;
const pgBin = 'C:/Program Files/PostgreSQL/18/bin';
const pgData = `${runtime}/postgres`;
const envPath = `${root}/server/.env.audit`;
const childEnv = { ...process.env, TMP: `${runtime}/temp`, TEMP: `${runtime}/temp` };
mkdirSync(`${runtime}/temp`, {recursive:true});
mkdirSync(`${runtime}/logs`, {recursive:true});
if (!existsSync(envPath)) {
 const dbPass = randomBytes(24).toString('hex');
 const auditPass = 'Glacier-' + randomBytes(12).toString('hex') + '!';
 writeFileSync(envPath, [
 `DATABASE_URL=postgresql://audit_db:${dbPass}@127.0.0.1:55432/taskira_ui_audit`,
 `JWT_SECRET=${randomBytes(40).toString('hex')}`,
 'RATE_LIMIT_LOGIN_MAX=100', 'AUTH_MODE=local', 'ADMIN_USERNAME=audit_admin', `ADMIN_PASSWORD=${auditPass}`,
 `AUDIT_USER_PASSWORD=${auditPass}`, 'ADMIN_NAME=Анна Сафина',
 'HOST=127.0.0.1', 'PORT=8080', 'CORS_ORIGIN=http://localhost:3000,http://127.0.0.1:3000',
 'APP_BASE_URL=http://localhost:3000', 'SESSION_COOKIE_SECURE=false',
 'STORAGE_DRIVER=local', `STORAGE_DIR=${runtime}/attachments`,
 'INSTANCE_NAME=Taskira', 'PROJECT_KEY=UX', 'PROJECT_NAME=Рабочие процессы',
 'DEFAULT_DEPARTMENT=Продуктовая команда', 'DUE_REMINDER_TIMEZONE=Asia/Tashkent',
 'DUE_REMINDER_ENABLED=false', 'MAINTENANCE_ENABLED=false', 'NOTIFY_EMAIL_ENABLED=false',
 'WEBHOOKS_ENABLED=false', 'RECURRING_ENABLED=false',
 ].join('\n')+'\n');
}
const config = Object.fromEntries(readFileSync(envPath,'utf8').trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const dbUrl = new URL(config.DATABASE_URL);
if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '55432' || dbUrl.pathname !== '/taskira_ui_audit') throw new Error('Unsafe database target');
const options = {env:childEnv, windowsHide:true, encoding:'utf8',timeout:60000};
if (!existsSync(`${pgData}/PG_VERSION`)) {
 writeFileSync(`${runtime}/.pg-password`,decodeURIComponent(dbUrl.password)+'\n');
 execFileSync(`${pgBin}/initdb.exe`,['-D',pgData,'-U','audit_db','--auth=scram-sha-256','--encoding=UTF8','--locale=C',`--pwfile=${runtime}/.pg-password`],options);
}
try { execFileSync(`${pgBin}/pg_ctl.exe`,['-D',pgData,'status'],options); }
catch { execFileSync(`${pgBin}/pg_ctl.exe`,['-D',pgData,'-l',`${runtime}/logs/postgres.log`,'-o','-p 55432 -h 127.0.0.1','-w','start'],{...options,stdio:'ignore'}); }
const sqlOptions = {...options, env:{...childEnv,PGPASSWORD:decodeURIComponent(dbUrl.password)}};
const exists = execFileSync(`${pgBin}/psql.exe`,['-h','127.0.0.1','-p','55432','-U','audit_db','-d','postgres','-tAc',"SELECT 1 FROM pg_database WHERE datname='taskira_ui_audit'"],sqlOptions).trim();
if(exists!=='1')execFileSync(`${pgBin}/createdb.exe`,['-h','127.0.0.1','-p','55432','-U','audit_db','taskira_ui_audit'],sqlOptions);
console.log(JSON.stringify({database:'taskira_ui_audit',port:55432,data:pgData,env:envPath}));
