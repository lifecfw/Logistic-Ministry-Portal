import { Router, type IRouter, type Request, type Response } from "express";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";
import { creditBankOwner } from "../lib/bank-revenue";
import { getSql } from "../lib/db";

const router: IRouter = Router();

const BOT_BASE_URL = process.env.AFMOD_BOT_URL || "";
const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";

function requireUser(req: Request, res: Response): { userId: string; username: string; displayName: string } | null {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized", message: "Not signed in" }); return null; }
  const user = getSession(sessionId);
  if (!user)       { res.status(401).json({ error: "unauthorized", message: "Session expired" }); return null; }
  return { userId: user.id, username: user.username, displayName: user.displayName };
}

async function forwardToBot(path: string, body: unknown) {
  if (!BOT_BASE_URL || !BOT_API_KEY) {
    return { ok: false as const, status: 503, message: "Bot not configured" };
  }
  try {
    const res = await fetch(BOT_BASE_URL.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    logger.error({ err, path }, "Failed to reach AFMOD bot");
    return { ok: false as const, status: 503, message: "Bot unreachable" };
  }
}

async function getFromBot(path: string) {
  if (!BOT_BASE_URL || !BOT_API_KEY) {
    return { ok: false as const, status: 503, message: "Bot not configured" };
  }
  try {
    const res = await fetch(BOT_BASE_URL.replace(/\/$/, "") + path, {
      method: "GET",
      headers: { "X-AFMOD-API-Key": BOT_API_KEY },
      signal: AbortSignal.timeout(8_000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    logger.error({ err, path }, "Failed to reach AFMOD bot");
    return { ok: false as const, status: 503, message: "Bot unreachable" };
  }
}

// ── Balance ─────────────────────────────────────────────────────────────────
router.get("/showroom/balance", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = await getFromBot(`/afmod/balance/${user.userId}`);
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: "message" in result ? result.message : "Failed" });
    return;
  }
  res.json(result.data);
});

// ── Buy car ─────────────────────────────────────────────────────────────────
router.post("/showroom/buy-car", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const carId = typeof req.body?.carId === "string" ? req.body.carId : "";
  const price = Number(req.body?.price) || 0;
  if (!carId) { res.status(400).json({ error: "bad_request", message: "carId is required" }); return; }
  const result = await forwardToBot("/afmod/buy-car", {
    carId, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }
  if (price > 0) await creditBankOwner(price, `شراء سيارة: ${carId}`);
  res.json({ ok: true, ...(result.data || {}) });
});

// ── Buy house ────────────────────────────────────────────────────────────────
router.post("/showroom/buy-house", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const houseId = typeof req.body?.houseId === "string" ? req.body.houseId : "";
  const price   = Number(req.body?.price) || 0;
  if (!houseId) { res.status(400).json({ error: "bad_request", message: "houseId is required" }); return; }
  const result = await forwardToBot("/afmod/buy-house", {
    houseId, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }
  try {
    const sql = getSql();
    const now = Date.now();
    await sql`
      INSERT INTO house_ownership (house_id, owner_user_id, owner_username, owner_display_name, purchased_at)
      VALUES (${houseId}, ${user.userId}, ${user.username}, ${user.displayName}, ${now})
      ON CONFLICT (house_id, owner_user_id) DO NOTHING
    `;
  } catch (err) {
    logger.warn({ err }, "Failed to record house ownership");
  }
  if (price > 0) await creditBankOwner(price, `شراء بيت: ${houseId}`);
  res.json({ ok: true, ...(result.data || {}) });
});

// ── Houses owned ─────────────────────────────────────────────────────────────
router.get("/showroom/houses-owned", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const sql = getSql();
    const rows = await sql`
      SELECT house_id, purchased_at FROM house_ownership
      WHERE owner_user_id = ${user.userId}
      ORDER BY purchased_at DESC
    `;
    res.json({ owned: rows });
  } catch (err) {
    logger.warn({ err }, "Failed to fetch house ownership");
    res.json({ owned: [] });
  }
});

// ── Buy gas station ──────────────────────────────────────────────────────────
router.post("/showroom/buy-gas-station", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const stationId = typeof req.body?.stationId === "string" ? req.body.stationId : "";
  const price     = Number(req.body?.price) || 0;
  if (!stationId) { res.status(400).json({ error: "bad_request", message: "stationId is required" }); return; }
  const result = await forwardToBot("/afmod/buy-gas-station", {
    stationId, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }
  if (price > 0) await creditBankOwner(price, `شراء محطة وقود: ${stationId}`);
  res.json({ ok: true, ...(result.data || {}) });
});

// ── My Properties ────────────────────────────────────────────────────────────
router.get("/showroom/my-properties", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const result = await getFromBot(`/afmod/my-properties/${user.userId}`);
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: "message" in result ? result.message : "Failed" });
    return;
  }
  res.json(result.data);
});

// ── Buy grocery store ────────────────────────────────────────────────────────
router.post("/showroom/buy-grocery", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const stationId = typeof req.body?.stationId === "string" ? req.body.stationId : "";
  const price     = Number(req.body?.price) || 0;
  if (!stationId) { res.status(400).json({ error: "bad_request", message: "stationId is required" }); return; }
  const result = await forwardToBot("/afmod/buy-grocery", {
    stationId, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }
  if (price > 0) await creditBankOwner(price, `شراء بقالة: ${stationId}`);
  res.json({ ok: true, ...(result.data || {}) });
});

// ── Buy barber shop ───────────────────────────────────────────────────────────
router.post("/showroom/buy-barber", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const shopId = typeof req.body?.shopId === "string" ? req.body.shopId : "";
  const price  = Number(req.body?.price) || 0;
  if (!shopId) { res.status(400).json({ error: "bad_request", message: "shopId is required" }); return; }
  const result = await forwardToBot("/afmod/buy-barber", {
    shopId, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }
  if (price > 0) await creditBankOwner(price, `شراء صالون حلاقة: ${shopId}`);
  res.json({ ok: true, ...(result.data || {}) });
});

// ── POST /showroom/buy-business ───────────────────────────────────────────────
router.post("/showroom/buy-business", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const shopId       = typeof req.body?.shopId === "string"       ? req.body.shopId.trim()       : "";
  const businessType = typeof req.body?.businessType === "string" ? req.body.businessType.trim() : "";
  const price        = Number(req.body?.price) || 0;
  const VALID = ["cafe","mexican","burger","bakery","rickjohns","apparel","dollar","tools","market","jewels","bank","guns"];
  if (!shopId || !VALID.includes(businessType)) {
    res.status(400).json({ error: "bad_request", message: "shopId and valid businessType are required" }); return;
  }
  const result = await forwardToBot("/afmod/buy-business", {
    shopId, businessType, userId: user.userId, username: user.username, displayName: user.displayName,
  });
  if (!result.ok) {
    res.status(result.status).json({ error: "bot_error", message: ("message" in result && result.message) || "Bot rejected the purchase" });
    return;
  }

  // If bank was purchased, record the new owner
  if (businessType === "bank") {
    try {
      const sql = getSql();
      const now = Date.now();
      await sql`
        INSERT INTO bank_owner (user_id, username, display_name, purchased_at)
        VALUES (${user.userId}, ${user.username}, ${user.displayName}, ${now})
      `;
    } catch (err) {
      logger.warn({ err }, "Failed to record bank owner");
    }
  } else if (price > 0) {
    // Non-bank business purchases go to bank owner
    await creditBankOwner(price, `شراء مشروع (${businessType}): ${shopId}`);
  }

  res.json({ ok: true, ...(result.data || {}) });
});

export default router;
