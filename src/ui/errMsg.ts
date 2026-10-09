// Readable text for whatever a failed call threw (an Error, a Supabase error object, a string, or nothing).
export function errMsg(e: unknown): string {
  const m = typeof e === 'string' ? e : (e as { message?: unknown } | null | undefined)?.message;
  return typeof m === 'string' && m ? m : 'unknown error';
}
