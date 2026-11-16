/**
 * Agent log: one line per event on stdout/stderr. Messages pass through `redact`, so even an
 * error text that happens to quote key material is never printed.
 */

export type LogLevel = 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string) => void;

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /"private_key(_id)?"\s*:\s*"[^"]*"/g,
  /\bya29\.[A-Za-z0-9._-]+/g, // OAuth access tokens
  /\bBearer\s+[A-Za-z0-9._-]+/gi,
];

export function redact(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]');
  return out;
}

export const consoleLogger: Logger = (level, message) => {
  const line = `${new Date().toISOString()} [cloud-agent] ${level.toUpperCase()} ${redact(message)}\n`;
  (level === 'info' ? process.stdout : process.stderr).write(line);
};
