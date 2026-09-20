export const PASSWORD_MIN_LENGTH = 14;

const KNOWN_DEFAULTS = new Set([
  "admin",
  "admin123",
  "changeme",
  "changeit",
  "password",
  "password123",
  "taskira",
  "taskira123",
]);

/** Policy for local and break-glass accounts. LDAP passwords are governed by AD. */
export function passwordPolicyError(password: string, username?: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Пароль должен содержать не менее ${PASSWORD_MIN_LENGTH} символов`;
  if (password.length > 128) return "Пароль должен содержать не более 128 символов";

  const normalized = password.trim().toLowerCase();
  if (KNOWN_DEFAULTS.has(normalized)) return "Нельзя использовать известный пароль по умолчанию";
  if (username && normalized.includes(username.trim().toLowerCase()))
    return "Пароль не должен содержать имя пользователя";

  const groups = [/[a-z]/.test(password), /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)]
    .filter(Boolean).length;
  if (groups < 3) return "Пароль должен включать символы как минимум трёх типов: строчные, заглавные, цифры, специальные";
  return null;
}
