/** Quote one literal argument for the POSIX shell used by the local wizard. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
