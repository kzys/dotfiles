// Writing dates as the searches of GitHub, Slack and Linear take them.

/** Returns date as YYYY-MM-DD in local time. */
export function day(date: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}
