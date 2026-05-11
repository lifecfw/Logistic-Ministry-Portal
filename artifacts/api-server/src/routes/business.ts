import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";
import { creditBankOwner } from "../lib/bank-revenue";

const router = Router();

const DEPLETION_PER_HOUR = 4;
const WEEK_MS = 7 * 24 * 3_600_000;

const PROFIT_CFG = {
  gas:      { minHr: 2083, maxHr: 4167, weekMin: 300_000, weekMax: 500_000 },
  grocery:  { minHr:  833, maxHr: 2083, weekMin: 100_000, weekMax: 300_000 },
  barber:   { minHr:  625, maxHr: 1250, weekMin:  75_000, weekMax: 150_000 },
  cafe:     { minHr:  700, maxHr: 1500, weekMin:  80_000, weekMax: 200_000 },
  mexican:  { minHr:  833, maxHr: 1667, weekMin: 100_000, weekMax: 250_000 },
  burger:   { minHr:  750, maxHr: 1500, weekMin:  80_000, weekMax: 200_000 },
  bakery:   { minHr:  550, maxHr: 1100, weekMin:  60_000, weekMax: 140_000 },
  rickjohns:{ minHr:  625, maxHr: 1333, weekMin:  75_000, weekMax: 185_000 },
  apparel:  { minHr:  625, maxHr: 1250, weekMin:  75_000, weekMax: 175_000 },
  dollar:   { minHr:  500, maxHr: 1100, weekMin:  55_000, weekMax: 140_000 },
  tools:    { minHr:  625, maxHr: 1333, weekMin:  75_000, weekMax: 185_000 },
  market:   { minHr:  500, maxHr: 1100, weekMin:  55_000, weekMax: 140_000 },
  jewels:   { minHr:  833, maxHr: 2083, weekMin: 100_000, weekMax: 280_000 },
  bank:     { minHr: 1250, maxHr: 3333, weekMin: 175_000, weekMax: 450_000 },
  guns:     { minHr:  833, maxHr: 1667, weekMin: 100_000, weekMax: 245_000 },
} as const;

// Items customers can buy from each business type
const CUSTOMER_ITEMS: Record<string, { name: string; price: number }[]> = {
  gas: [
    { name: "تعبئة ربع خزان", price: 250 },
    { name: "تعبئة نصف خزان", price: 500 },
    { name: "تعبئة كاملة",     price: 950 },
  ],
  grocery: [
    { name: "كرتون مياه",   price:  80 },
    { name: "مشروب غازي",   price:  50 },
    { name: "حليب",          price:  90 },
    { name: "خبز",           price:  45 },
    { name: "أرز",           price: 120 },
    { name: "زيت طعام",     price: 150 },
    { name: "سكر",           price:  70 },
    { name: "شاي وقهوة",    price: 110 },
    { name: "سلة خضار",     price: 200 },
  ],
  barber: [
    { name: "حلاقة شعر",       price: 200 },
    { name: "حلاقة لحية",      price: 150 },
    { name: "حلاقة + تسريح",   price: 350 },
  ],
  cafe: [
    { name: "قهوة عربية",   price: 100 },
    { name: "كابتشينو",      price: 150 },
    { name: "كيكة",          price: 200 },
    { name: "وجبة خفيفة",   price: 280 },
  ],
  mexican: [
    { name: "تاكو",          price: 250 },
    { name: "بوريتو",        price: 350 },
    { name: "ناتشوز",        price: 200 },
    { name: "وجبة كاملة",   price: 550 },
  ],
  burger: [
    { name: "برغر",              price: 300 },
    { name: "فراخ مقلية",        price: 250 },
    { name: "وجبة برغر كاملة",  price: 450 },
    { name: "وجبة عائلية",       price: 800 },
  ],
  bakery: [
    { name: "كرواسون",       price: 100 },
    { name: "كيكة",          price: 180 },
    { name: "حلويات متنوعة", price: 250 },
    { name: "خبز طازج",     price:  80 },
  ],
  rickjohns: [
    { name: "وجبة ريك جونز", price: 400 },
    { name: "بيتزا",          price: 500 },
    { name: "باستا",          price: 350 },
    { name: "سلطة",           price: 200 },
  ],
  apparel: [
    { name: "قميص",   price:  500 },
    { name: "بنطلون", price:  700 },
    { name: "حذاء",   price: 1200 },
    { name: "طاقية",  price:  300 },
  ],
  dollar: [
    { name: "منتجات منزلية",   price: 150 },
    { name: "أدوات مكتبية",   price: 100 },
    { name: "مستلزمات متنوعة", price: 200 },
  ],
  tools: [
    { name: "أدوات يدوية",   price: 400 },
    { name: "معدات ورشة",    price: 800 },
    { name: "مواد بناء",     price: 600 },
  ],
  market: [
    { name: "خضار طازجة",    price: 150 },
    { name: "فواكه موسمية",  price: 200 },
    { name: "لحوم طازجة",   price: 400 },
  ],
  jewels: [
    { name: "خاتم",  price: 2000 },
    { name: "قلادة", price: 2500 },
    { name: "سوار",  price: 1800 },
    { name: "أقراط", price: 1500 },
  ],
  guns: [
    { name: "ذخيرة خفيفة",   price: 300 },
    { name: "ذخيرة متوسطة",  price: 500 },
    { name: "معدات تنظيف",   price: 200 },
  ],
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function calcInventory(lastRefillAt: number, now: number): number {
  if (!lastRefillAt) return 0;
  const hours = (now - lastRefillAt) / 3_600_000;
  return Math.max(0, 100 - hours * DEPLETION_PER_HOUR);
}

function calcAccruedProfit(type: string, lastRefillAt: number, lastSyncAt: number, now: number): number {
  if (!lastRefillAt) return 0;
  const cfg = PROFIT_CFG[type as keyof typeof PROFIT_CFG];
  if (!cfg) return 0;
  const emptyAt = lastRefillAt + (100 / DEPLETION_PER_HOUR) * 3_600_000;
  const from = Math.max(lastSyncAt, lastRefillAt);
  const to   = Math.min(now, emptyAt);
  if (to <= from) return 0;
  const hours = (to - from) / 3_600_000;
  return Math.floor(rand(cfg.minHr, cfg.maxHr) * hours);
}

function requireUser(req: Request, res: Response) {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user)    { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

// ── GET state ────────────────────────────────────────────────────────────────
router.get("/business/state", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { businessId, type } = req.query as Record<string, string>;
  if (!businessId || !["gas","grocery","barber","cafe","mexican","burger","bakery","rickjohns","apparel","dollar","tools","market","jewels","bank","guns"].includes(type)) {
    res.status(400).json({ error: "invalid params" }); return;
  }

  const sql = getSql();
  const now = Date.now();

  // Check if another user already owns this business
  const [otherOwner] = await sql`
    SELECT user_id FROM business_state
    WHERE business_id = ${businessId} AND business_type = ${type} AND user_id != ${user.id}
    LIMIT 1
  `;
  if (otherOwner) {
    res.status(409).json({ error: "already_owned", message: "هذا المشروع مملوك من قِبَل شخص آخر" });
    return;
  }

  await sql`
    INSERT INTO business_state
      (user_id, business_id, business_type, inventory_pct, last_refill_at, last_sync_at, weekly_bonus_at)
    VALUES
      (${user.id}, ${businessId}, ${type}, 100, ${now}, ${now}, ${now})
    ON CONFLICT (user_id, business_id, business_type) DO NOTHING
  `;

  const [st] = await sql`
    SELECT * FROM business_state
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
  `;

  const lastRefillAt  = Number(st.last_refill_at);
  const lastSyncAt    = Number(st.last_sync_at);
  const weeklyBonusAt = Number(st.weekly_bonus_at);

  const currentInv = calcInventory(lastRefillAt, now);
  const accrued    = calcAccruedProfit(type, lastRefillAt, lastSyncAt, now);

  let weeklyBonus = 0;
  if (lastRefillAt > 0 && (now - weeklyBonusAt) >= WEEK_MS) {
    const cfg = PROFIT_CFG[type as keyof typeof PROFIT_CFG];
    weeklyBonus = Math.floor(rand(cfg.weekMin, cfg.weekMax));
  }

  const totalNew       = accrued + weeklyBonus;
  const newAccumulated = Number(st.accumulated_profit) + totalNew;

  if (totalNew > 0) {
    const note = weeklyBonus > 0 ? "يشمل مكافأة أسبوعية" : "دخل دوري";
    await sql`
      INSERT INTO business_profit_log (user_id, business_id, business_type, amount, note, logged_at)
      VALUES (${user.id}, ${businessId}, ${type}, ${totalNew}, ${note}, ${now})
    `;
  }

  await sql`
    UPDATE business_state SET
      inventory_pct      = ${currentInv},
      accumulated_profit = ${newAccumulated},
      last_sync_at       = ${now},
      weekly_bonus_at    = ${weeklyBonus > 0 ? now : weeklyBonusAt}
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
  `;

  const log = await sql`
    SELECT amount, note, logged_at FROM business_profit_log
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
      AND amount > 0
    ORDER BY logged_at DESC LIMIT 30
  `;

  const hoursLeft = currentInv > 0 ? (currentInv / DEPLETION_PER_HOUR).toFixed(1) : "0";

  res.json({
    inventoryPct:      currentInv,
    accumulatedProfit: newAccumulated,
    lastRefillAt,
    hoursLeft,
    profitLog: [...log].reverse(),
  });
});

// ── POST refill ───────────────────────────────────────────────────────────────
router.post("/business/refill", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { businessId, type, inventoryAdd, cost, discountPct } = req.body as Record<string, unknown>;
  if (!businessId || !type || !inventoryAdd || cost === undefined) {
    res.status(400).json({ error: "invalid params" }); return;
  }

  const rawDiscount    = Math.min(30, Math.max(0, Number(discountPct) || 0));
  const discountedCost = Math.floor(Number(cost) * (1 - rawDiscount / 100));

  const sql = getSql();
  const now = Date.now();

  const [st] = await sql`
    SELECT * FROM business_state
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
  `;
  if (!st) { res.status(404).json({ error: "business not found" }); return; }

  const accumulated = Number(st.accumulated_profit);
  const costNum     = discountedCost;
  if (accumulated < costNum) {
    res.status(402).json({ error: "insufficient_balance", message: "الأرباح المتراكمة لا تكفي لإتمام الشراء" });
    return;
  }

  const currentInv     = calcInventory(Number(st.last_refill_at), now);
  const newInv         = Math.min(100, currentInv + Number(inventoryAdd));
  const adjustedRefillAt = now - ((100 - newInv) / DEPLETION_PER_HOUR) * 3_600_000;

  await sql`
    UPDATE business_state SET
      inventory_pct      = ${newInv},
      last_refill_at     = ${adjustedRefillAt},
      last_sync_at       = ${now},
      accumulated_profit = ${accumulated - costNum}
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
  `;

  const logNote = rawDiscount > 0 ? `شراء مخزون (خصم ${rawDiscount}%)` : "شراء مخزون";
  await sql`
    INSERT INTO business_profit_log (user_id, business_id, business_type, amount, note, logged_at)
    VALUES (${user.id}, ${businessId}, ${type}, ${-costNum}, ${logNote}, ${now})
  `;

  // Credit bank owner with refill cost
  if (costNum > 0) await creditBankOwner(costNum, `شراء مخزون (${type}): ${businessId}`);

  res.json({ ok: true, inventoryPct: newInv, accumulatedProfit: accumulated - costNum, discountApplied: rawDiscount });
});

// ── POST withdraw ─────────────────────────────────────────────────────────────
router.post("/business/withdraw", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { businessId, type } = req.body as Record<string, string>;
  if (!businessId || !type) { res.status(400).json({ error: "invalid params" }); return; }

  const sql = getSql();
  const now = Date.now();

  const [st] = await sql`
    SELECT * FROM business_state
    WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}
  `;
  if (!st) { res.status(404).json({ error: "not found" }); return; }

  const amount = Number(st.accumulated_profit);
  if (amount <= 0) {
    res.status(400).json({ error: "no_profit", message: "لا يوجد رصيد لسحبه" });
    return;
  }

  const BOT_BASE_URL = process.env.AFMOD_BOT_URL || "";
  const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";
  if (BOT_BASE_URL && BOT_API_KEY) {
    try {
      await fetch(BOT_BASE_URL.replace(/\/$/, "") + "/afmod/credit-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
        body: JSON.stringify({ userId: user.id, amount, reason: `أرباح مشروع: ${businessId}` }),
        signal: AbortSignal.timeout(8_000),
      });
    } catch (err) {
      logger.warn({ err }, "Bot credit call failed");
    }
  }

  await sql`UPDATE business_state SET accumulated_profit = 0 WHERE user_id = ${user.id} AND business_id = ${businessId} AND business_type = ${type}`;
  await sql`
    INSERT INTO business_profit_log (user_id, business_id, business_type, amount, note, logged_at)
    VALUES (${user.id}, ${businessId}, ${type}, ${-amount}, 'سحب أرباح', ${now})
  `;

  res.json({ ok: true, withdrawn: amount });
});

// ── GET /business/marketplace ─────────────────────────────────────────────────
// Returns all active businesses (inventory > 0) for customer browsing
router.get("/business/marketplace", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();
  const now = Date.now();

  const rows = await sql`
    SELECT bs.user_id, bs.business_id, bs.business_type, bs.last_refill_at,
           COALESCE(tp.username, '') as username, COALESCE(tp.display_name, '') as display_name
    FROM business_state bs
    LEFT JOIN tw_profiles tp ON tp.user_id = bs.user_id
    WHERE bs.last_refill_at > 0
    ORDER BY bs.business_type, bs.last_refill_at DESC
  `;

  // Filter to businesses with >5% inventory and that have customer items
  const active = rows
    .filter(r => {
      const inv = calcInventory(Number(r.last_refill_at), now);
      return inv > 5 && CUSTOMER_ITEMS[r.business_type as string];
    })
    .map(r => ({
      userId:        r.user_id,
      businessId:    r.business_id,
      businessType:  r.business_type,
      username:      r.username,
      displayName:   r.display_name,
      inventoryPct:  Math.round(calcInventory(Number(r.last_refill_at), now)),
      items:         CUSTOMER_ITEMS[r.business_type as string] || [],
    }));

  res.json({ businesses: active });
});

// ── POST /business/customer-buy ───────────────────────────────────────────────
// Customer buys an item from a business owner
router.post("/business/customer-buy", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { businessId, businessType, sellerUserId, itemName } = req.body as Record<string, unknown>;
  if (!businessId || !businessType || !sellerUserId || !itemName) {
    res.status(400).json({ error: "invalid params" }); return;
  }

  const items = CUSTOMER_ITEMS[businessType as string];
  if (!items) { res.status(400).json({ error: "no_items", message: "هذا المشروع لا يدعم الشراء المباشر" }); return; }

  const item = items.find(i => i.name === itemName);
  if (!item) { res.status(400).json({ error: "item_not_found", message: "المنتج غير موجود" }); return; }

  if (sellerUserId === user.id) {
    res.status(400).json({ error: "self_purchase", message: "لا يمكنك الشراء من مشروعك الخاص" }); return;
  }

  const sql  = getSql();
  const now  = Date.now();

  // Check business inventory
  const [st] = await sql`
    SELECT * FROM business_state
    WHERE user_id = ${String(sellerUserId)} AND business_id = ${String(businessId)} AND business_type = ${String(businessType)}
  `;
  if (!st) { res.status(404).json({ error: "business_not_found", message: "المشروع غير موجود" }); return; }

  const inv = calcInventory(Number(st.last_refill_at), now);
  if (inv < 5) {
    res.status(402).json({ error: "empty_inventory", message: "المخزون فارغ، أخبر صاحب المشروع بالتعبئة" }); return;
  }

  // Deduct from buyer via bot
  const BOT_BASE_URL = process.env.AFMOD_BOT_URL || "";
  const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";
  if (BOT_BASE_URL && BOT_API_KEY) {
    try {
      const r = await fetch(BOT_BASE_URL.replace(/\/$/, "") + "/afmod/deduct-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
        body: JSON.stringify({ userId: user.id, amount: item.price, reason: `شراء: ${item.name} من ${businessId}` }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({})) as Record<string, unknown>;
        const code = r.status;
        res.status(code === 402 ? 402 : 503).json({
          error: code === 402 ? "insufficient_funds" : "bot_error",
          message: (data.message as string) || (code === 402 ? "الرصيد غير كافٍ" : "البوت غير متصل"),
        });
        return;
      }
    } catch (err) {
      logger.warn({ err }, "Bot deduct-balance failed");
      res.status(503).json({ error: "bot_error", message: "البوت غير متصل" }); return;
    }
  }

  // Credit seller's business accumulated_profit
  await sql`
    UPDATE business_state SET accumulated_profit = accumulated_profit + ${item.price}
    WHERE user_id = ${String(sellerUserId)} AND business_id = ${String(businessId)} AND business_type = ${String(businessType)}
  `;
  await sql`
    INSERT INTO business_profit_log (user_id, business_id, business_type, amount, note, logged_at)
    VALUES (${String(sellerUserId)}, ${String(businessId)}, ${String(businessType)}, ${item.price}, ${`بيع للعميل: ${item.name}`}, ${now})
  `;

  // Log purchase
  await sql`
    INSERT INTO customer_purchases (buyer_user_id, buyer_username, seller_user_id, business_id, business_type, item_name, price, purchased_at)
    VALUES (${user.id}, ${user.username}, ${String(sellerUserId)}, ${String(businessId)}, ${String(businessType)}, ${String(itemName)}, ${item.price}, ${now})
  `;

  res.json({ ok: true, item: item.name, price: item.price });
});

// ── GET /business/customer-purchases ─────────────────────────────────────────
// Business owner sees purchases made from their businesses
router.get("/business/customer-purchases", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();
  const rows = await sql`
    SELECT buyer_username, business_id, business_type, item_name, price, purchased_at
    FROM customer_purchases
    WHERE seller_user_id = ${user.id}
    ORDER BY purchased_at DESC
    LIMIT 50
  `;
  res.json({ purchases: rows });
});

export default router;
