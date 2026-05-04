// ============================================
// House rental routes
// ============================================
import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";

const router = Router();

const HOUSE_PRICES: Record<string, number> = {
  "single-trailer": 55_000,
  "log-cabin":      65_000,
  "double-trailer": 72_000,
  "small-house":    85_000,
  "medium-house":  130_000,
  "large-house":   220_000,
};

function requireUser(req: Request, res: Response) {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user)    { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

async function botPost(path: string, body: unknown) {
  const BOT_BASE_URL = process.env.AFMOD_BOT_URL    || "";
  const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";
  if (!BOT_BASE_URL || !BOT_API_KEY) return { ok: false, status: 503 };
  try {
    const r = await fetch(BOT_BASE_URL.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, status: 503 }; }
}

// ── GET /house/my-listing?houseId= ──────────────────────────────────────────
router.get("/house/my-listing", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const houseId = String(req.query.houseId || "");
  if (!houseId) { res.status(400).json({ error: "houseId required" }); return; }
  const sql = getSql();
  const rows = await sql`
    SELECT hrl.*, COUNT(hrb.id) FILTER (WHERE hrb.is_active AND hrb.expires_at > ${Date.now()}) AS active_bookings
    FROM house_rental_listings hrl
    LEFT JOIN house_rental_bookings hrb ON hrb.listing_id = hrl.id
    WHERE hrl.house_id = ${houseId} AND hrl.owner_user_id = ${user.id}
    GROUP BY hrl.id
  `;
  res.json({ listing: rows[0] || null });
});

// ── GET /house/listings ──────────────────────────────────────────────────────
router.get("/house/listings", async (req, res) => {
  const sql = getSql();
  const listings = await sql`
    SELECT hrl.*,
      COUNT(hrb.id) FILTER (WHERE hrb.is_active AND hrb.expires_at > ${Date.now()}) AS active_bookings
    FROM house_rental_listings hrl
    LEFT JOIN house_rental_bookings hrb ON hrb.listing_id = hrl.id
    WHERE hrl.is_available = true
    GROUP BY hrl.id
    ORDER BY hrl.updated_at DESC
  `;
  res.json({ listings });
});

// ── POST /house/set-rental ───────────────────────────────────────────────────
router.post("/house/set-rental", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { houseId, dailyPrice, isAvailable, notes } = req.body as Record<string, unknown>;

  const housePrice = HOUSE_PRICES[String(houseId || "")];
  if (!housePrice) { res.status(400).json({ error: "invalid_house", message: "نوع البيت غير صحيح، تأكد من الرابط" }); return; }

  const dp = Number(dailyPrice);
  const minP = Math.floor(housePrice * 0.10);
  const maxP = Math.floor(housePrice * 0.15);
  if (dp < minP || dp > maxP) {
    res.status(400).json({ error: "invalid_price", minPrice: minP, maxPrice: maxP,
      message: `السعر اليومي يجب أن يكون بين $${minP.toLocaleString("en")} و $${maxP.toLocaleString("en")}` });
    return;
  }

  const sql = getSql();
  const [owned] = await sql`SELECT id FROM house_ownership WHERE house_id=${String(houseId)} AND owner_user_id=${user.id}`;
  if (!owned) { res.status(403).json({ error: "not_owner", message: "هذا البيت غير مسجّل باسمك في قاعدة البيانات. يجب شراؤه عبر البوابة الرسمية أولاً" }); return; }

  const now = Date.now();
  await sql`
    INSERT INTO house_rental_listings
      (house_id, owner_user_id, owner_username, owner_display_name, daily_price, is_available, notes, updated_at)
    VALUES
      (${String(houseId)}, ${user.id}, ${user.username}, ${user.displayName},
       ${dp}, ${Boolean(isAvailable)}, ${String(notes || "")}, ${now})
    ON CONFLICT (house_id, owner_user_id) DO UPDATE SET
      daily_price       = EXCLUDED.daily_price,
      is_available      = EXCLUDED.is_available,
      notes             = EXCLUDED.notes,
      owner_display_name = EXCLUDED.owner_display_name,
      updated_at        = EXCLUDED.updated_at
  `;
  res.json({ ok: true });
});

// ── GET /house/state?houseId= ────────────────────────────────────────────────
router.get("/house/state", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const houseId = String(req.query.houseId || "");
  if (!houseId) { res.status(400).json({ error: "houseId required" }); return; }

  const sql = getSql();
  const [owned] = await sql`SELECT id FROM house_ownership WHERE house_id=${houseId} AND owner_user_id=${user.id}`;
  if (!owned) { res.status(403).json({ error: "not_owner", message: "هذا البيت غير مسجّل باسمك. يجب شراؤه عبر البوابة الرسمية أولاً" }); return; }

  await sql`
    INSERT INTO house_rental_state (house_id, owner_user_id, accumulated_profit)
    VALUES (${houseId}, ${user.id}, 0) ON CONFLICT DO NOTHING
  `;
  const [st] = await sql`SELECT * FROM house_rental_state WHERE house_id=${houseId} AND owner_user_id=${user.id}`;
  const [listing] = await sql`SELECT * FROM house_rental_listings WHERE house_id=${houseId} AND owner_user_id=${user.id}`;

  const log = await sql`
    SELECT amount, note, logged_at FROM house_rental_profit_log
    WHERE owner_user_id=${user.id} AND house_id=${houseId}
    ORDER BY logged_at DESC LIMIT 30
  `;

  const activeBookings = await sql`
    SELECT hrb.*, hrl.owner_user_id FROM house_rental_bookings hrb
    JOIN house_rental_listings hrl ON hrb.listing_id = hrl.id
    WHERE hrl.house_id=${houseId} AND hrl.owner_user_id=${user.id}
      AND hrb.is_active=true AND hrb.expires_at>${Date.now()}
  `;

  res.json({
    accumulatedProfit: Number(st?.accumulated_profit ?? 0),
    listing: listing || null,
    profitLog: [...log].reverse(),
    activeBookings,
    housePrice: HOUSE_PRICES[houseId] || 0,
  });
});

// ── POST /house/rent ─────────────────────────────────────────────────────────
router.post("/house/rent", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { houseId, ownerUserId, days } = req.body as Record<string, unknown>;
  const daysNum = Math.max(1, Math.min(30, Number(days) || 1));
  const sql = getSql();

  const [listing] = await sql`
    SELECT * FROM house_rental_listings
    WHERE house_id=${String(houseId)} AND owner_user_id=${String(ownerUserId)} AND is_available=true
  `;
  if (!listing) { res.status(404).json({ error: "listing_not_found", message: "هذا العرض لم يعد متاحاً" }); return; }

  const totalCost = Number(listing.daily_price) * daysNum;
  const now = Date.now();

  // Attempt to deduct from renter's balance via bot
  const deduct = await botPost("/afmod/deduct-balance", {
    userId: user.id, amount: totalCost, reason: `إيجار بيت ${daysNum} يوم`,
  });
  if (!deduct.ok && (deduct as { status: number }).status === 402) {
    res.status(402).json({ error: "insufficient_balance", message: "الرصيد غير كافٍ" }); return;
  }

  // Credit owner
  await sql`
    INSERT INTO house_rental_state (house_id, owner_user_id, accumulated_profit)
    VALUES (${String(houseId)}, ${String(ownerUserId)}, ${totalCost})
    ON CONFLICT (house_id, owner_user_id) DO UPDATE SET
      accumulated_profit = house_rental_state.accumulated_profit + EXCLUDED.accumulated_profit
  `;

  await sql`
    INSERT INTO house_rental_profit_log (owner_user_id, house_id, amount, note, logged_at)
    VALUES (${String(ownerUserId)}, ${String(houseId)}, ${totalCost},
            ${'إيجار ' + daysNum + ' يوم — ' + (user.displayName || user.username)}, ${now})
  `;

  // Record booking
  const expiresAt = now + daysNum * 24 * 3_600_000;
  await sql`
    INSERT INTO house_rental_bookings
      (listing_id, house_id, renter_user_id, renter_username, renter_display_name, days, daily_price, total_price, started_at, expires_at, is_active)
    VALUES
      (${Number(listing.id)}, ${String(houseId)}, ${user.id}, ${user.username}, ${user.displayName},
       ${daysNum}, ${Number(listing.daily_price)}, ${totalCost}, ${now}, ${expiresAt}, true)
  `;

  res.json({ ok: true, totalCost, days: daysNum, expiresAt });
});

// ── POST /house/withdraw ─────────────────────────────────────────────────────
router.post("/house/withdraw", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { houseId } = req.body as Record<string, string>;
  if (!houseId) { res.status(400).json({ error: "houseId required" }); return; }
  const sql = getSql();

  const [st] = await sql`SELECT * FROM house_rental_state WHERE house_id=${houseId} AND owner_user_id=${user.id}`;
  if (!st) { res.status(404).json({ error: "not_found" }); return; }

  const amount = Number(st.accumulated_profit);
  if (amount <= 0) { res.status(400).json({ error: "no_profit", message: "لا يوجد رصيد لسحبه" }); return; }

  await botPost("/afmod/credit-balance", { userId: user.id, amount, reason: `أرباح إيجار بيت: ${houseId}` });

  await sql`UPDATE house_rental_state SET accumulated_profit=0 WHERE house_id=${houseId} AND owner_user_id=${user.id}`;
  const now = Date.now();
  await sql`
    INSERT INTO house_rental_profit_log (owner_user_id, house_id, amount, note, logged_at)
    VALUES (${user.id}, ${houseId}, ${-amount}, 'سحب أرباح', ${now})
  `;
  res.json({ ok: true, withdrawn: amount });
});

export default router;
