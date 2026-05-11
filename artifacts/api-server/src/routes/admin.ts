import { Router, type Request, type Response } from "express";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { query } from "../lib/db";
import { logger } from "../lib/logger";

const router = Router();

const ADMIN_USERNAME = "n16q";

function requireAdmin(req: Request, res: Response) {
  const cookies   = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user) { res.status(401).json({ error: "unauthorized" }); return null; }
  if (user.username !== ADMIN_USERNAME) { res.status(403).json({ error: "forbidden", message: "أدمن فقط" }); return null; }
  return user;
}

// ── GET /admin/stats ──────────────────────────────────────────────────────────
router.get("/admin/stats", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    const counts = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM house_ownership`),
      query(`SELECT COUNT(*) AS n FROM business_state`),
      query(`SELECT COUNT(*) AS n FROM gangs`),
      query(`SELECT COUNT(*) AS n FROM marketplace_listings WHERE status='active'`),
      query(`SELECT COUNT(*) AS n FROM house_rental_listings WHERE is_available=true`),
      query(`SELECT COUNT(*) AS n FROM tw_profiles`),
      query(`SELECT COUNT(*) AS n FROM msg_profiles`),
      query(`SELECT COUNT(*) AS n FROM known_users`),
    ]);
    res.json({
      houses:         Number(counts[0].rows[0]?.n ?? 0),
      businesses:     Number(counts[1].rows[0]?.n ?? 0),
      gangs:          Number(counts[2].rows[0]?.n ?? 0),
      listings:       Number(counts[3].rows[0]?.n ?? 0),
      rentalListings: Number(counts[4].rows[0]?.n ?? 0),
      twitterUsers:   Number(counts[5].rows[0]?.n ?? 0),
      msgUsers:       Number(counts[6].rows[0]?.n ?? 0),
      knownUsers:     Number(counts[7].rows[0]?.n ?? 0),
    });
  } catch (err) {
    logger.error({ err }, "Admin stats failed");
    res.status(500).json({ error: "internal_error", message: String((err as Error).message) });
  }
});

// ── POST /admin/reset-data ────────────────────────────────────────────────────
router.post("/admin/reset-data", async (req, res) => {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  const { confirm } = req.body as Record<string, unknown>;
  if (confirm !== "RESET_ALL_DATA") {
    return res.status(400).json({ error: "bad_request", message: "أرسل confirm: 'RESET_ALL_DATA' للتأكيد" });
  }

  const tables = [
    "house_rental_profit_log",
    "house_rental_bookings",
    "house_rental_state",
    "house_rental_listings",
    "house_ownership",
    "business_profit_log",
    "business_state",
    "customer_purchases",
    "manufacture_weapons",
    "manufacture_tables",
    "manufacture_resources",
    "gang_log",
    "gang_treasury_log",
    "gang_sprays",
    "gang_weapons",
    "gang_resources",
    "gang_members",
    "gangs",
    "marketplace_transactions",
    "marketplace_listings",
    "bank_owner",
    "tw_notifications",
    "tw_tweets",
    "tw_profiles",
    "msg_chats",
    "msg_groups",
    "msg_profiles",
    "known_users",
  ];

  try {
    for (const table of tables) {
      await query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    await query(`UPDATE msg_config SET value = '1001' WHERE key = 'next_phone'`);
    logger.info({ admin: admin.username }, "Full data reset performed");
    res.json({ ok: true, message: "تم تصفير جميع البيانات بنجاح", tablesCleared: tables.length });
  } catch (err) {
    logger.error({ err }, "Data reset failed");
    res.status(500).json({ error: "internal_error", message: String((err as Error).message) });
  }
});

export default router;
