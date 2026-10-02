import type { User } from "./types";

export function greetingName(user: Pick<User, "name" | "givenName" | "authSource"> | null | undefined): string {
  if (!user) return "";
  const given = user.givenName?.trim();
  if (given) return given;
  // До следующего LDAP-входа (или если атрибут пуст) сохраняем полное имя.
  // Не называем человека фамилией и не предполагаем порядок слов в каталоге.
  const name = user.name.trim();
  return user.authSource === "ldap" ? name : name.split(/\s+/)[0];
}
