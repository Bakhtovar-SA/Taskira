# STORAGE_SETUP — хранилище вложений на реальном on-prem S3/MinIO

Эксплуатационная инструкция: как перевести сервер с локального диска
(`STORAGE_DRIVER=local`) на S3-совместимое объектное хранилище
(`STORAGE_DRIVER=s3`) — MinIO, Ceph RGW, любой S3 API. Проектные решения — в
[FILES_MIGRATION.md](FILES_MIGRATION.md) (§3, D1–D6). Локальный тестовый MinIO —
[server/docker-compose.storage.yml](server/docker-compose.storage.yml).

> Разработка велась против **MinIO** — «большого» AWS S3 в контуре не было.
> Отличия отмечены по тексту; §9 — краткая таблица `local` ↔ `s3`.

---

## 1. Что делает сервер при `STORAGE_DRIVER=s3`

- **Загрузка.** Файл проходит через сервер (проверка размера/типа/magic-байт,
  [D3](FILES_MIGRATION.md)), затем `@aws-sdk/lib-storage` `Upload` кладёт его в
  бакет под ключом `<issueId>/<uuid>`. Библиотека сама выбирает `PutObject` или
  **multipart-upload** по размеру потока (порог `partSize` — 5 MiB).
- **Скачивание.** `GET …/attachments/:attId` — после `requireIssuePerm("browse")`
  сервер `GetObject`-ом берёт поток и **проксирует** его клиенту с заголовками
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` ([D5](FILES_MIGRATION.md)).
  Presigned-URL по умолчанию **не** используются (см. §5).
- **Удаление.** Прямое удаление вложения и удаление задачи снимают объект
  (`DeleteObject`, идемпотентно). Удаление **проекта** объекты пока не чистит —
  сборщик сирот, [FILES_MIGRATION.md Фаза 6](FILES_MIGRATION.md).
- `attachments.storage_driver` в строке = `s3`. После переключения с `local`
  старые строки остаются `local` — чем читать их, сервер знает по этому полю
  (перенос — §6).

---

## 2. Переменные окружения

`server/.env` (не в git; см. `server/.env.example`). При `STORAGE_DRIVER=s3`
сервер **падает на старте**, если не задан обязательный ключ.

| Переменная | Обяз. | Пример MinIO | Пример «большого» S3 | Назначение |
|---|---|---|---|---|
| `STORAGE_DRIVER` | да | `s3` | `s3` | `local` (деф.) \| `s3` |
| `STORAGE_S3_ENDPOINT` | да | `http://minio.corp:9000` | `https://s3.eu-central-1.amazonaws.com` | адрес S3 API |
| `STORAGE_S3_BUCKET` | да | `taskira-attachments` | `corp-taskira-prod` | бакет (создать заранее, §3) |
| `STORAGE_S3_REGION` | — | `us-east-1` (деф.) | `eu-central-1` | регион; MinIO — обычно `us-east-1` |
| `STORAGE_S3_ACCESS_KEY` | да | — | — | ключ сервис-аккаунта |
| `STORAGE_S3_SECRET_KEY` | да | — | — | секрет; только env, не логировать |
| `STORAGE_S3_FORCE_PATH_STYLE` | — | `true` | `false` | `true` для MinIO/Ceph (path-style), `false` для AWS (virtual-hosted) |
| `ATTACH_MAX_BYTES` / `_PER_ISSUE` / `_FILENAME` | — | как в `local` | — | лимиты приёма ([D3](FILES_MIGRATION.md)); от драйвера не зависят |

`STORAGE_DIR` при `s3` игнорируется.

**TLS.** Для `https://`-эндпоинта с приватным CA — общесистемно
`NODE_EXTRA_CA_CERTS=/path/ca.pem`. `STORAGE_S3_FORCE_PATH_STYLE=true` не влияет
на TLS, только на форму URL.

---

## 3. Бакет и сервис-ключ

1. **Создать приватный бакет** `STORAGE_S3_BUCKET`. Публичного доступа быть не
   должно — файлы отдаёт только сервер после проверки прав.
   - MinIO: `mc mb local/taskira-attachments && mc anonymous set none local/taskira-attachments`.
   - AWS: Block Public Access = on; никаких bucket policy с `Principal: "*"`.
2. **Сервис-ключ с минимальными правами** на этот один бакет:
   `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`
   (+ `s3:AbortMultipartUpload` — нужен `lib-storage` при обрыве multipart).
   Пример IAM-политики:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:ListBucket"], "Resource": "arn:aws:s3:::corp-taskira-prod" },
       { "Effect": "Allow",
         "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:AbortMultipartUpload"],
         "Resource": "arn:aws:s3:::corp-taskira-prod/*" }
     ]
   }
   ```
   - MinIO: `mc admin user svcacct add` или политика через `mc admin policy`.
3. **Шифрование на покое** — рекомендуется: SSE-S3 (AES-256) или SSE-KMS на
   бакете. На загрузку/скачивание не влияет; **ETag при SSE-KMS перестаёт быть
   hex-MD5** (учтено в тестах — проверка ETag=MD5 только для не-KMS бакета).
4. **Lifecycle**: правило «удалять неполные multipart-загрузки старше 1 дня» —
   защита от накопления мусора при обрывах.

---

## 4. Проверка

```bash
# сервер должен стартовать без [config]-ошибок
npm run start   # или npm run dev

# smoke: загрузка/скачивание через API (нужен токен глоб. admin)
curl -sf -X POST "http://localhost:8080/api/projects/$PID/issues/$ISS/attachments" \
  -H "Authorization: Bearer $TOKEN" -F "file=@/path/to/report.pdf"
# -> 201 + { id, filename, byteSize, sha256, ... }

# объект реально в бакете:
mc ls --recursive local/taskira-attachments
```

CI-job `storage-s3` (`.github/workflows/test.yml`) поднимает MinIO из
`docker-compose.storage.yml` и гоняет `npm run test:storage` —
`access.attachments.test.ts` (роут+драйвер) + `storage.s3.test.ts`
(специфика протокола S3: ETag однокусочного PUT = MD5 тела; большой объект →
настоящий multipart, ETag `<md5>-<N>`; round-trip `Content-Type`; `NoSuchKey`
на отсутствующем ключе).

---

## 5. Прокси через API vs presigned URL

По умолчанию сервер **проксирует** каждый GET/PUT: файл идёт через процесс,
каждый запрос авторизуется `requireIssuePerm`. Так «наследование видимости
задачи» ([D4/D5](FILES_MIGRATION.md)) не размывается — нет ссылки, которая живёт
дольше проверки прав.

**Presigned GET** (короткий, ≤ 60 с, выдаётся только после
`requireIssuePerm("browse")`) — возможная оптимизация под большие файлы/трафик;
в MVP **выключено**. Если включать: настроить **CORS бакета** под origin
клиента (нужно и для будущего presigned-**PUT** прямо из браузера, follow-up).
Долгоживущие public/presigned ссылки — не использовать: переживают отзыв
доступа к задаче.

---

## 6. Перенос существующих файлов `local → s3`

1. Развернуть S3-бакет и ключ (§3), заполнить `STORAGE_S3_*`, оставить
   `STORAGE_DRIVER=local`, перезапустить, `npm run start` — сервер стартует.
2. Перелить объекты: для каждой строки `attachments` с `storage_driver='local'`
   прочитать файл из `STORAGE_DIR/<storage_key>`, `PutObject` в бакет под тем же
   ключом, затем `UPDATE attachments SET storage_driver='s3' WHERE id=…`.
   (Разовый скрипт; в репозитории его нет — набор действий выше однозначен.)
   Пока строка ещё `local` — сервер читает её с диска; после `UPDATE` — из S3.
   Расхождения нет в любой момент.
3. Переключить `STORAGE_DRIVER=s3`, перезапустить. Новые вложения идут в S3.
4. Убедиться, что скачивание старых работает, затем удалить `STORAGE_DIR`.

Откат: `STORAGE_DRIVER=local` + перезапуск — но строки, ставшие `s3`, с диска
уже не читаются; если нужен быстрый откат, не удаляйте `STORAGE_DIR` и не
делайте `UPDATE` до окончания приёмки.

---

## 7. Бэкап

Объектное хранилище — отдельный контур бэкапа, в один ряд с
[server/BACKUP.md](server/BACKUP.md) (там — `pg_dump`):

- MinIO: `mc mirror --overwrite local/taskira-attachments /backup/attachments`
  по расписанию, либо репликация бакета (`mc replicate`).
- AWS: версионирование бакета + межрегиональная репликация / резервная копия.
- **БД и бакет бэкапить согласованно.** Строка `attachments` без объекта →
  «битое» вложение в UI; объект без строки → мусор (его подберёт сборщик сирот).

---

## 8. Траблшутинг

| Симптом | Причина / что делать |
|---|---|
| `[config] STORAGE_DRIVER=s3: не задан STORAGE_S3_…` | не хватает обязательного ключа — §2 |
| `SignatureDoesNotMatch` | рассинхрон часов сервера и S3 (> 15 мин) → NTP; либо неверный `STORAGE_S3_REGION` |
| `The specified bucket does not exist` / `NoSuchBucket` | бакет не создан или опечатка в `STORAGE_S3_BUCKET` |
| Все запросы к MinIO → `AccessDenied` при верных ключах | не выставлен `STORAGE_S3_FORCE_PATH_STYLE=true` (MinIO не любит virtual-hosted) |
| `self signed certificate` / `unable to verify` на `https://` | приватный CA → `NODE_EXTRA_CA_CERTS=/path/ca.pem` |
| Загрузка больших файлов рвётся, в бакете растут `.../uploads/` | нет права `s3:AbortMultipartUpload` у ключа и/или нет lifecycle-правила на неполные multipart (§3) |
| Скачивание `.svg`/`.html` открывается как страница | не должно: сервер шлёт `Content-Disposition: attachment` + `nosniff` и активные типы → `application/octet-stream`; проверить, что клиент не ходит в обход API |
| ETag в тестах не равен MD5 | на бакете включён SSE-KMS — это ожидаемо; проверка ETag=MD5 актуальна только для не-KMS |
| `storage.s3.test.ts` — `describe.skip` | не заданы `STORAGE_DRIVER=s3` + `STORAGE_S3_ENDPOINT` |

---

## 9. `local` ≠ `s3` — сводка

| | `STORAGE_DRIVER=local` | `STORAGE_DRIVER=s3` |
|---|---|---|
| Где лежит | файл в `STORAGE_DIR/<issueId>/<uuid>` | объект в бакете под тем же ключом |
| Несколько серверов | ❌ (upload на узле A, download через LB с B → 404) | ✅ |
| Загрузка | temp-файл + атомарный `rename` | `PutObject` / multipart (`lib-storage`) |
| `stat()` | только размер | размер + `ETag` + `Content-Type` (round-trip метаданных) |
| Метаданные типа | только в строке `attachments` | ещё и в объекте (`Content-Type`) |
| Setup | ничего (каталог создаётся сам) | бакет + ключ + политика (§3) |
| Бэкап | вместе с файловой системой | отдельно (`mc mirror` / репликация, §7) |

Кода, завязанного на конкретный бэкенд, вне `services/storage.ts` нет —
роуты и `services/attachments.ts` работают только с интерфейсом `Storage`.
