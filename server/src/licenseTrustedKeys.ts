/**
 * Доверенные публичные ключи проверки лицензии (ТЗ 4.3), по `kid` из заголовка JWT-лицензии.
 * Публичные ключи — не секрет, этот файл коммитится. Приватный ключ, которым подписывается
 * лицензия, — секрет, который НИКОГДА не попадает в репозиторий; см. docs/LICENSE_KEYS.md.
 *
 * Пусто по умолчанию: ни одна лицензия ещё не выпускалась — это ожидаемо, не ошибка конфигурации
 * (getLicenseStatus() вернёт "unset", пока instance.license_key не заполнен, независимо от того,
 * пуст этот реестр или нет). Перед первым реальным выпуском лицензии: сгенерировать пару ключей
 * (см. docs/LICENSE_KEYS.md), добавить сюда публичный ключ под новым `kid`, задеплоить эту версию
 * сервера ДО того, как выпущенная этим ключом лицензия попадёт к клиенту — иначе сервер клиента не
 * узнает kid и отклонит лицензию (unknown_kid).
 *
 * Ротация: добавить новую пару { kid, pem }, НЕ удаляя старую — старый kid остаётся доверенным,
 * пока не истекут все лицензии, выпущенные им (см. docs/LICENSE_KEYS.md, «При компрометации»).
 */
export const LICENSE_TRUSTED_KEYS: Record<string, string> = {
  // "2026-09": `-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n`,
  "2026-10": `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEApuZcvjMPIWZDjkn8DySo
aWYV9yz92CPxzHbhNFxPkV3u8/wWVDUAsv7NSlBT3AuYeCn/RRW0ATmdhslzUcvf
KLgFwOszEY+mtrLfq6LdBpC6ImAAPViFWfK+vUvZeQSc0xlODFCxkjsZcEV302Gz
d7vcHFVK810f13s9HS1ExBv/ljUgvXJQw1afltXzy9hDb697DskoW5SrVTf6DV4O
OJRoQWRJRv6hC6nuB2wFqYBr2IEj4uVakbv+aPhI0XMEzZ8eHwKnvL/FGu/9HfLr
ogNgaKk8gNvZtCai3dCRexWUe2h8w7RHyLn8ooRisM+ouVbrxggx0knP9QZNuSIh
2xGI4wV7J4M+f0spWeGc3kd0FkZNgICwHZYsa/mQbEMEfCXqG7UceFY09KR8GFz8
mxDwsTV+9eE9K+vMUo/1oawDh899yQHnRSxBnGHzAKsAswCiEl3QVJ3TSYgrQyrF
ftVI+weBTVjqI3QY60FkHS8hXIl9WgnJCR4QQxc79AipAgMBAAE=
-----END PUBLIC KEY-----
`,
};
