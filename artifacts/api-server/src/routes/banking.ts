import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";

const router = Router();

const BOT_BASE_URL = () => (process.env.AFMOD_BOT_URL || "").replace(/\/$/, "");
const BOT_API_KEY  = () => process.env.AFMOD_BOT_API_KEY || "";

function requireUser(req: Request, res: Response) {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user) { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

async function getFromBot(path: string) {
  const base = BOT_BASE_URL();
  if (!base) return { ok: false as const, status: 503, message: "Bot not configured" };
  try {
    const r = await fetch(base + path, {
      method: "GET",
      headers: { "X-AFMOD-API-Key": BOT_API_KEY() },
      signal: AbortSignal.timeout(8_000),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    logger.error({ err, path }, "Failed to reach AFMOD bot (bank)");
    return { ok: false as const, status: 503, message: "Bot unreachable" };
  }
}

async function postToBot(path: string, body: unknown) {
  const base = BOT_BASE_URL();
  if (!base) return { ok: false as const, status: 503, message: "Bot not configured" };
  try {
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    logger.error({ err, path }, "Failed to reach AFMOD bot (bank transfer)");
    return { ok: false as const, status: 503, message: "Bot unreachable" };
  }
}

// GET /api/bank-system/balance
router.get("/bank-system/balance", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const result = await getFromBot(`/afmod/balance/${user.id}`);
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: "message" in result ? result.message : "Failed to fetch balance" });
    return;
  }
  res.json(result.data);
});

// POST /api/bank-system/transfer
router.post("/bank-system/transfer", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { toUsername, amount, note } = req.body as { toUsername?: string; amount?: number; note?: string };

  if (!toUsername?.trim()) { res.status(400).json({ error: "toUsername required" }); return; }
  if (!amount || amount <= 0 || !Number.isFinite(Number(amount))) { res.status(400).json({ error: "invalid amount" }); return; }
  const amtInt = Math.floor(Number(amount));
  if (amtInt < 1) { res.status(400).json({ error: "amount must be at least $1" }); return; }

  const toUname = toUsername.trim().toLowerCase().replace(/^@/, "");
  if (toUname === user.username.toLowerCase()) { res.status(400).json({ error: "cannot_transfer_to_self", message: "لا يمكن التحويل لنفسك" }); return; }

  const sql = getSql();
  const knownRows = await sql`SELECT user_id, username, display_name FROM known_users WHERE lower(username) = ${toUname} LIMIT 1`;
  const recipient = knownRows[0] as { user_id: string; username: string; display_name: string } | undefined;
  if (!recipient) { res.status(404).json({ error: "recipient_not_found", message: "لم يُعثر على المستخدم في السيرفر" }); return; }

  const botResult = await postToBot("/afmod/bank-transfer", {
    fromUserId: user.id,
    fromUsername: user.username,
    toUserId: recipient.user_id,
    toUsername: recipient.username,
    amount: amtInt,
    note: (note || "").trim().slice(0, 200),
  });

  if (!botResult.ok) {
    const is402 = botResult.status === 402;
    const message = is402 ? "رصيدك غير كافٍ" : ("message" in botResult ? botResult.message : "تعذّر الاتصال بالسيرفر");
    res.status(is402 ? 402 : 503).json({ error: is402 ? "insufficient_balance" : "bot_error", message });
    return;
  }

  const now = Date.now();
  await sql`
    INSERT INTO bank_transfers (from_user_id, from_username, to_user_id, to_username, amount, note, transferred_at)
    VALUES (${user.id}, ${user.username}, ${recipient.user_id}, ${recipient.username}, ${amtInt}, ${(note || "").trim().slice(0, 200)}, ${now})
  `;

  res.json({ ok: true, toUsername: recipient.username, toDisplayName: recipient.display_name || recipient.username, amount: amtInt });
});

// GET /api/bank-system/log
router.get("/bank-system/log", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();

  const [transfers, purchases] = await Promise.all([
    sql`SELECT * FROM bank_transfers WHERE from_user_id = ${user.id} OR to_user_id = ${user.id} ORDER BY transferred_at DESC LIMIT 50`,
    sql`SELECT * FROM customer_purchases WHERE buyer_user_id = ${user.id} ORDER BY purchased_at DESC LIMIT 50`,
  ]);

  const entries: any[] = [
    ...(transfers as any[]).map(r => ({
      type: r.from_user_id === user.id ? "transfer_out" : "transfer_in",
      amount: Number(r.amount),
      direction: r.from_user_id === user.id ? "out" : "in",
      counterpart: r.from_user_id === user.id ? (r.to_username || "—") : (r.from_username || "—"),
      note: r.note || "",
      at: Number(r.transferred_at),
    })),
    ...(purchases as any[]).map(r => ({
      type: "purchase",
      amount: Number(r.price),
      direction: "out",
      counterpart: r.business_type || "—",
      note: r.item_name || "",
      at: Number(r.purchased_at),
    })),
  ];

  entries.sort((a, b) => b.at - a.at);
  res.json(entries.slice(0, 60));
});

export default router;
