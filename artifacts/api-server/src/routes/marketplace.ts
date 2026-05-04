import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";
import pg from "pg";

const router = Router();

const BOT_BASE_URL = process.env.AFMOD_BOT_URL    || "";
const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";

const ITEM_TYPES     = ["resource","weapon","car","house","business","other"];
const RESOURCE_NAMES = ["steel","aluminum","plastic","iron","coal"];
const MAX_PRICE = 999_999_999;
const MAX_QTY   = 9_999;

function requireUser(req: Request, res: Response) {
  const cookies   = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user)      { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

function getPool(): pg.Pool {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is not configured");
  return new pg.Pool({ connectionString: url, ssl: false });
}
const _pool = getPool();
async function rawQuery(text: string, values?: unknown[]) {
  const result = await _pool.query(text, values as unknown[]);
  return result.rows as Record<string, unknown>[];
}

async function botTransfer(fromId: string, toId: string, amount: number, note: string) {
  if (!BOT_BASE_URL || !BOT_API_KEY) return { ok: false, pending: true };
  try {
    const r = await fetch(BOT_BASE_URL.replace(/\/$/, "") + "/afmod/marketplace-pay", {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
      body:    JSON.stringify({ fromId, toId, amount, note }),
      signal:  AbortSignal.timeout(10_000),
    });
    return { ok: r.ok, pending: !r.ok };
  } catch (err) {
    logger.warn({ err }, "Bot marketplace-pay unreachable — transaction marked pending");
    return { ok: false, pending: true };
  }
}

// ── GET /marketplace/listings ─────────────────────────────────────────────────
router.get("/marketplace/listings", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const filter = typeof req.query.type === "string" ? req.query.type : "all";
  try {
    const rows = filter === "all"
      ? await rawQuery(`SELECT * FROM marketplace_listings WHERE status='active' ORDER BY created_at DESC LIMIT 100`)
      : await rawQuery(`SELECT * FROM marketplace_listings WHERE status='active' AND item_type=$1 ORDER BY created_at DESC LIMIT 100`, [filter]);
    res.json({ listings: rows });
  } catch (err) {
    logger.error({ err }, "Failed to fetch listings");
    res.json({ listings: [] });
  }
});

// ── POST /marketplace/list ────────────────────────────────────────────────────
router.post("/marketplace/list", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { itemType, itemName, quantity, price, description } = req.body as Record<string, unknown>;

  if (!ITEM_TYPES.includes(String(itemType))) {
    return res.status(400).json({ error: "bad_request", message: "نوع العنصر غير صالح" });
  }
  const name = String(itemName || "").trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: "bad_request", message: "أدخل اسم العنصر" });

  if (itemType === "resource" && !RESOURCE_NAMES.includes(name)) {
    return res.status(400).json({ error: "bad_request", message: "اسم المورد غير صالح" });
  }

  const qty    = Math.max(1, Math.min(MAX_QTY, Number(quantity) || 1));
  const priceN = Number(price) || 0;
  if (priceN <= 0 || priceN > MAX_PRICE) {
    return res.status(400).json({ error: "bad_request", message: "السعر يجب أن يكون بين 1 و 999,999,999" });
  }
  const desc = String(description || "").trim().slice(0, 300);

  try {
    // Check & deduct resources/weapons
    if (itemType === "resource" && RESOURCE_NAMES.includes(name)) {
      const rows = await rawQuery(`SELECT ${name} FROM manufacture_resources WHERE user_id=$1`, [user.id]);
      const have = Number(rows[0]?.[name] ?? 0);
      if (have < qty) {
        return res.status(400).json({ error: "insufficient", message: `لا تملك كمية كافية (لديك ${have})` });
      }
      await rawQuery(`UPDATE manufacture_resources SET ${name}=${name}-$1 WHERE user_id=$2`, [qty, user.id]);
    }
    if (itemType === "weapon") {
      const rows = await rawQuery(`SELECT weapon_count FROM manufacture_resources WHERE user_id=$1`, [user.id]);
      const have = Number(rows[0]?.weapon_count ?? 0);
      if (have < qty) {
        return res.status(400).json({ error: "insufficient", message: `لا تملك عدداً كافياً من الأسلحة (لديك ${have})` });
      }
      await rawQuery(`UPDATE manufacture_resources SET weapon_count=weapon_count-$1 WHERE user_id=$2`, [qty, user.id]);
    }

    const now = Date.now();
    const inserted = await rawQuery(
      `INSERT INTO marketplace_listings
        (seller_user_id, seller_username, seller_display_name, item_type, item_name, quantity, price, description, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) RETURNING id`,
      [user.id, user.username, user.displayName, String(itemType), name, qty, priceN, desc, now]
    );
    res.json({ ok: true, id: inserted[0]?.id });
  } catch (err) {
    logger.error({ err }, "Failed to create listing");
    res.status(500).json({ error: "internal_error", message: "فشل إنشاء الإعلان" });
  }
});

// ── POST /marketplace/buy/:id ─────────────────────────────────────────────────
router.post("/marketplace/buy/:id", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const listingId = Number(req.params.id);
  if (!listingId) return res.status(400).json({ error: "bad_request", message: "معرّف غير صالح" });

  try {
    const rows = await rawQuery(`SELECT * FROM marketplace_listings WHERE id=$1 AND status='active'`, [listingId]);
    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "الإعلان غير موجود أو تم بيعه" });
    const l = rows[0];

    if (l.seller_user_id === user.id) {
      return res.status(400).json({ error: "bad_request", message: "لا يمكنك شراء إعلانك الخاص" });
    }

    const price = Number(l.price);
    const qty   = Number(l.quantity);
    const now   = Date.now();

    // Bot balance transfer buyer → seller
    const transfer = await botTransfer(user.id, String(l.seller_user_id), price, `مزادي #${listingId}`);

    // Mark as sold
    await rawQuery(`UPDATE marketplace_listings SET status='sold', sold_at=$1 WHERE id=$2`, [now, listingId]);

    // Record transaction
    await rawQuery(
      `INSERT INTO marketplace_transactions
        (listing_id,buyer_user_id,buyer_username,buyer_display_name,seller_user_id,seller_username,item_type,item_name,quantity,price,payment_status,bought_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [listingId, user.id, user.username, user.displayName,
       String(l.seller_user_id), String(l.seller_username),
       String(l.item_type), String(l.item_name), qty, price,
       transfer.pending ? "pending" : "ok", now]
    );

    // Credit item to buyer (resources / weapons)
    if (l.item_type === "resource" && RESOURCE_NAMES.includes(String(l.item_name))) {
      const col = String(l.item_name);
      await rawQuery(
        `INSERT INTO manufacture_resources (user_id, discord_username, ${col})
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET ${col}=manufacture_resources.${col}+$3`,
        [user.id, user.username, qty]
      );
    }
    if (l.item_type === "weapon") {
      await rawQuery(
        `INSERT INTO manufacture_resources (user_id, discord_username, weapon_count)
         VALUES ($1,$2,$3)
         ON CONFLICT (user_id) DO UPDATE SET weapon_count=manufacture_resources.weapon_count+$3`,
        [user.id, user.username, qty]
      );
    }

    res.json({ ok: true, paymentStatus: transfer.pending ? "pending" : "ok" });
  } catch (err) {
    logger.error({ err }, "Failed to buy listing");
    res.status(500).json({ error: "internal_error", message: "فشل عملية الشراء" });
  }
});

// ── DELETE /marketplace/listing/:id ──────────────────────────────────────────
router.delete("/marketplace/listing/:id", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const listingId = Number(req.params.id);
  if (!listingId) return res.status(400).json({ error: "bad_request", message: "معرّف غير صالح" });

  try {
    const rows = await rawQuery(
      `SELECT * FROM marketplace_listings WHERE id=$1 AND seller_user_id=$2 AND status='active'`,
      [listingId, user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found", message: "الإعلان غير موجود" });
    const l = rows[0];

    await rawQuery(`UPDATE marketplace_listings SET status='cancelled' WHERE id=$1`, [listingId]);

    // Return item to seller
    if (l.item_type === "resource" && RESOURCE_NAMES.includes(String(l.item_name))) {
      const col = String(l.item_name);
      const qty = Number(l.quantity);
      await rawQuery(`UPDATE manufacture_resources SET ${col}=${col}+$1 WHERE user_id=$2`, [qty, user.id]);
    }
    if (l.item_type === "weapon") {
      const qty = Number(l.quantity);
      await rawQuery(`UPDATE manufacture_resources SET weapon_count=weapon_count+$1 WHERE user_id=$2`, [qty, user.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Failed to cancel listing");
    res.status(500).json({ error: "internal_error", message: "فشل إلغاء الإعلان" });
  }
});

// ── GET /marketplace/my-listings ─────────────────────────────────────────────
router.get("/marketplace/my-listings", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const rows = await rawQuery(
      `SELECT * FROM marketplace_listings WHERE seller_user_id=$1 ORDER BY created_at DESC LIMIT 50`,
      [user.id]
    );
    res.json({ listings: rows });
  } catch (err) {
    logger.error({ err }, "Failed to fetch my listings");
    res.json({ listings: [] });
  }
});

// ── GET /marketplace/my-stats ─────────────────────────────────────────────────
router.get("/marketplace/my-stats", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const sold   = await rawQuery(`SELECT * FROM marketplace_transactions WHERE seller_user_id=$1 ORDER BY bought_at DESC LIMIT 50`, [user.id]);
    const bought = await rawQuery(`SELECT * FROM marketplace_transactions WHERE buyer_user_id=$1  ORDER BY bought_at DESC LIMIT 50`, [user.id]);

    const totalEarned = sold.reduce((s, r)   => s + Number(r.price), 0);
    const totalSpent  = bought.reduce((s, r)  => s + Number(r.price), 0);

    // Monthly chart data — last 6 months
    const now = Date.now();
    const months: { label: string; earned: number; spent: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now);
      d.setMonth(d.getMonth() - i);
      const label = d.toLocaleDateString("ar-SA", { month: "short" });
      const start = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59).getTime();
      const earned = sold.filter(r  => { const t = Number(r.bought_at); return t >= start && t <= end; }).reduce((s, r) => s + Number(r.price), 0);
      const spent  = bought.filter(r => { const t = Number(r.bought_at); return t >= start && t <= end; }).reduce((s, r) => s + Number(r.price), 0);
      months.push({ label, earned, spent });
    }

    res.json({ sold, bought, totalEarned, totalSpent, netProfit: totalEarned - totalSpent, soldCount: sold.length, boughtCount: bought.length, months });
  } catch (err) {
    logger.error({ err }, "Failed to fetch stats");
    res.status(500).json({ error: "internal_error", message: "فشل جلب الإحصائيات" });
  }
});

export default router;
