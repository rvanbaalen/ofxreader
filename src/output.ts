/** Write a successful result as JSON to stdout. */
export function emit(data: unknown, pretty: boolean): void {
  process.stdout.write(JSON.stringify(data, null, pretty ? 2 : 0) + "\n");
}

/** Write a structured error as JSON to stderr. */
export function emitError(code: string, message: string): void {
  process.stderr.write(JSON.stringify({ error: { code, message } }) + "\n");
}
