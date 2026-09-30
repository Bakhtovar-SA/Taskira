/** Keep ownership until HTTP/WS and the pool close; a stalled shutdown must exit. */
export async function closeWithDeadline(close: () => Promise<void>, timeoutMs = 10_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("API shutdown exceeded its deadline")), timeoutMs);
  });
  try {
    await Promise.race([close(), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
