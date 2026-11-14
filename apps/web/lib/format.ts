/** "12.3 MB" — binary units with the familiar labels the UI uses (Section 20: "PDF up to 20 MB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });
const dateTimeFormat = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

/** "Nov 9, 2026" in UTC, so the server and the browser render the same text. */
export function formatDate(value: string | Date): string {
  return dateFormat.format(typeof value === "string" ? new Date(value) : value);
}

/** "Nov 9, 2026, 2:15 PM UTC" for admin tables, where the exact moment matters. */
export function formatDateTime(value: string | Date): string {
  return `${dateTimeFormat.format(typeof value === "string" ? new Date(value) : value)} UTC`;
}

/** "3 h", "2 d": how long something has been waiting. */
export function formatAge(from: string | Date, now: Date = new Date()): string {
  const ms = now.getTime() - (typeof from === "string" ? new Date(from) : from).getTime();
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}
