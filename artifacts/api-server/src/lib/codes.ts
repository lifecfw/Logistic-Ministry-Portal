import crypto from "node:crypto";
import { getSql } from "./db";
import type { ResolvedDiscordUser } from "./discord";

const CODE_TTL_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 30 * 1000;
export const CODE_TTL_SECONDS = Math.floor(CODE_TTL_MS / 1000);

export interface IssueResult {
  code: string;
  expiresInSeconds: number;
}

export class CodeRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super("Code request rate limited");
    this.retryAfterSeconds = retryAfterSeconds;
    this.name = "CodeRateLimitError";
  }
}

function generateCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString().padStart(6, "0");
}

export async function issueCode(user: ResolvedDiscordUser): Promise<IssueResult> {
  const sql = getSql();
  const now = Date.now();
  const rows = await sql`SELECT created_at, expires_at FROM auth_codes WHERE user_id = ${user.id}`;
  if (rows.length > 0) {
    const existing = rows[0] as { created_at: number; expires_at: number };
    const createdAt = Number(existing.created_at);
    if (now - createdAt < REQUEST_COOLDOWN_MS) {
      const retryAfter = Math.ceil((REQUEST_COOLDOWN_MS - (now - createdAt)) / 1000);
      throw new CodeRateLimitError(retryAfter);
    }
  }
  const code = generateCode();
  const expiresAt = now + CODE_TTL_MS;
  await sql`
    INSERT INTO auth_codes (user_id, code, user_data, created_at, expires_at, attempts)
    VALUES (${user.id}, ${code}, ${JSON.stringify(user) as any}, ${now}, ${expiresAt}, 0)
    ON CONFLICT (user_id) DO UPDATE SET
      code = EXCLUDED.code,
      user_data = EXCLUDED.user_data,
      created_at = EXCLUDED.created_at,
      expires_at = EXCLUDED.expires_at,
      attempts = 0
  `;
  return { code, expiresInSeconds: CODE_TTL_SECONDS };
}

export async function consumeCode(
  discordUsername: string,
  submittedCode: string,
): Promise<ResolvedDiscordUser | null> {
  const sql = getSql();
  const normalized = discordUsername.trim().toLowerCase().replace(/^@+/, "");
  const now = Date.now();
  const rows = await sql`SELECT * FROM auth_codes WHERE expires_at > ${now}`;
  for (const row of rows as any[]) {
    const u = row.user_data as ResolvedDiscordUser;
    const matchesUsername =
      u.username.toLowerCase() === normalized ||
      (u.displayName || "").toLowerCase() === normalized;
    if (!matchesUsername) continue;
    if (Number(row.attempts) >= 6) {
      await sql`DELETE FROM auth_codes WHERE user_id = ${row.user_id}`;
      return null;
    }
    await sql`UPDATE auth_codes SET attempts = attempts + 1 WHERE user_id = ${row.user_id}`;
    if (row.code !== submittedCode.trim()) return null;
    await sql`DELETE FROM auth_codes WHERE user_id = ${row.user_id}`;
    return u;
  }
  return null;
}
