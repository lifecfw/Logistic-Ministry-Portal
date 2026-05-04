import crypto from "node:crypto";
import type { ResolvedDiscordUser } from "./discord";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = "afmod_sid";
export const SESSION_COOKIE_MAX_AGE_MS = SESSION_TTL_MS;

interface Payload {
  user: ResolvedDiscordUser;
  exp: number;
}

function getSecret(): string {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not configured");
  return secret;
}

function sign(data: string): string {
  return crypto.createHmac("sha256", getSecret()).update(data).digest("hex").slice(0, 32);
}

export function createSession(user: ResolvedDiscordUser): string {
  const payload: Payload = { user, exp: Date.now() + SESSION_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign(encoded);
  return `${encoded}.${sig}`;
}

export function getSession(cookie: string | undefined): ResolvedDiscordUser | null {
  if (!cookie) return null;
  const dot = cookie.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const expected = sign(encoded);
  try {
    if (expected.length !== sig.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  } catch {
    return null;
  }
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Payload;
  } catch {
    return null;
  }
  if (payload.exp < Date.now()) return null;
  return payload.user;
}

export function updateSessionUser(_cookie: string | undefined, _user: ResolvedDiscordUser): void {
  // Stateless — refresh is done via new cookie if needed; no-op here is safe
}

export function destroySession(_cookie: string | undefined): void {
  // Stateless — actual cookie deletion happens via res.clearCookie() in the route
}
