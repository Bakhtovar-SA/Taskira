export interface MentionRange { start: number; end: number; query: string }

/** Only the token at a collapsed caret opens suggestions; email addresses do not. */
export function mentionAt(text: string, caret: number, selectionEnd = caret): MentionRange | null {
  if (caret !== selectionEnd || caret < 0 || caret > text.length) return null;
  const match = /(?:^|[^\p{L}\p{N}_@])@([\p{L}\p{N}._-]{0,80})$/u.exec(text.slice(0, caret));
  if (!match) return null;
  const rest = /^[\p{L}\p{N}._-]*/u.exec(text.slice(caret))![0];
  return { start: caret - match[1].length - 1, end: caret + rest.length, query: match[1] };
}

export function insertMention(text: string, range: MentionRange, username: string, maxLength = Infinity): { text: string; caret: number } | null {
  if (!/^[a-z0-9._-]{3,32}$/i.test(username)) return null;
  const suffix = text.slice(range.end);
  const token = `@${username}${/^\s/.test(suffix) ? "" : " "}`;
  const next = text.slice(0, range.start) + token + suffix;
  return next.length > maxLength ? null : { text: next, caret: range.start + token.length };
}
