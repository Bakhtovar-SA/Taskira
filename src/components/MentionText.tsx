/** Текст комментария/описания с подсветкой @-упоминаний (NOTIFICATIONS_MIGRATION.md D5). */
export function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9._-]{3,32})/gi);
  return (
    <>
      {parts.map((p, i) =>
        /^@[a-z0-9._-]{3,32}$/i.test(p) ? (
          <span key={i} className="rounded bg-accentsoft px-1 font-semibold text-accenttext">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
