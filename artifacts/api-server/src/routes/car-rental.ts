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

async function postToBot(path: string, body: unknown) {
  const base = BOT_BASE_URL();
  if (!base) return { ok: true as const };
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
    logger.error({ err, path }, "Failed to reach AFMOD bot (car rental)");
    return { ok: false as const, status: 503 };
  }
}

// POST /api/car/rent
router.post("/car/rent", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { carId, carName, carImage, carPrice, hours } = req.body as {
    carId?: string; carName?: string; carImage?: string; carPrice?: number; hours?: number;
  };

  if (!carId?.trim()) { res.status(400).json({ error: "carId required" }); return; }
  if (!carName?.trim()) { res.status(400).json({ error: "carName required" }); return; }
  if (!carPrice || carPrice <= 0 || !Number.isFinite(carPrice)) { res.status(400).json({ error: "invalid carPrice" }); return; }
  const hoursInt = Math.floor(Number(hours) || 1);
  if (hoursInt < 1 || hoursInt > 24) { res.status(400).json({ error: "hours must be 1-24" }); return; }

  const sql = getSql();
  const activeCheck = await sql`
    SELECT id FROM car_rentals
    WHERE renter_user_id = ${user.id} AND car_id = ${carId} AND is_active = true AND expires_at > ${Date.now()}
  `;
  if (activeCheck.length) { res.status(409).json({ error: "already_renting", message: "لديك إيجار نشط لهذه السيارة" }); return; }

  const pricePerHour = Math.floor(Number(carPrice) * 0.10);
  const totalPrice   = pricePerHour * hoursInt;
  const now          = Date.now();
  const expiresAt    = now + hoursInt * 3600_000;

  const botResult = await postToBot("/afmod/rent-car", {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    carId,
    carName,
    totalPrice,
    hours: hoursInt,
  });

  if (botResult.ok === false && "status" in botResult && botResult.status && botResult.status !== 503) {
    res.status(402).json({ error: "insufficient_balance", message: "رصيدك غير كافٍ" });
    return;
  }

  await sql`
    INSERT INTO car_rentals (car_id, car_name, car_image, car_price, renter_user_id, renter_username, price_per_hour, hours, total_price, started_at, expires_at, is_active)
    VALUES (${carId}, ${carName || ""}, ${carImage || ""}, ${Math.floor(Number(carPrice))}, ${user.id}, ${user.username}, ${pricePerHour}, ${hoursInt}, ${totalPrice}, ${now}, ${expiresAt}, true)
  `;

  res.json({ ok: true, pricePerHour, totalPrice, expiresAt });
});

// GET /api/car/rentals
router.get("/car/rentals", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const now = Date.now();

  await sql`UPDATE car_rentals SET is_active = false WHERE renter_user_id = ${user.id} AND expires_at <= ${now} AND is_active = true`;

  const rows = await sql`
    SELECT * FROM car_rentals WHERE renter_user_id = ${user.id}
    ORDER BY started_at DESC LIMIT 20
  `;
  res.json((rows as any[]).map(r => ({
    id: Number(r.id),
    carId: r.car_id,
    carName: r.car_name,
    carImage: r.car_image,
    carPrice: Number(r.car_price),
    pricePerHour: Number(r.price_per_hour),
    hours: Number(r.hours),
    totalPrice: Number(r.total_price),
    startedAt: Number(r.started_at),
    expiresAt: Number(r.expires_at),
    isActive: !!r.is_active,
    timeLeftMs: Math.max(0, Number(r.expires_at) - now),
  })));
});

// DELETE /api/car/rentals/:id  (end rental early — no refund)
router.delete("/car/rentals/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const rows = await sql`SELECT * FROM car_rentals WHERE id = ${req.params.id} AND renter_user_id = ${user.id}`;
  if (!rows.length) { res.status(404).json({ error: "not_found" }); return; }
  await sql`UPDATE car_rentals SET is_active = false WHERE id = ${req.params.id}`;
  res.json({ ok: true });
});

export default router;
