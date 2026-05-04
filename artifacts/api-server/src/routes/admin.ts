import { Router, type Request, type Response } from "express";
import pg from "pg";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { logger } from "../lib/logger";

const router = Router();

const ADMIN_USERNAME = "n16q";

function getPool(): pg.Pool {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL not configured");
  return new pg.Pool({ connectionString: url, ssl: false });
}
const _pool = getPool();
async function rawQuery(text: string, values?: unknown[]) {
  const result = await _pool.query(text, values as unknown[]);
  return result.rows as Record<string, unknown>[];
}

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
      rawQuery(`SELECT COUNT(*) AS n FROM house_ownership`),
      rawQuery(`SELECT COUNT(*) AS n FROM business_state`),
      rawQuery(`SELECT COUNT(*) AS n FROM gangs`),
      rawQuery(`SELECT COUNT(*) AS n FROM marketplace_listings WHERE status='active'`),
      rawQuery(`SELECT COUNT(*) AS n FROM house_rental_listings WHERE is_available=true`),
      rawQuery(`SELECT COUNT(*) AS n FROM tw_profiles`),
      rawQuery(`SELECT COUNT(*) AS n FROM msg_profiles`),
      rawQuery(`SELECT COUNT(*) AS n FROM known_users`),
    ]);
    res.json({
      houses:         Number(counts[0][0]?.n ?? 0),
      businesses:     Number(counts[1][0]?.n ?? 0),
      gangs:          Number(counts[2][0]?.n ?? 0),
      listings:       Number(counts[3][0]?.n ?? 0),
      rentalListings: Number(counts[4][0]?.n ?? 0),
      twitterUsers:   Number(counts[5][0]?.n ?? 0),
      msgUsers:       Number(counts[6][0]?.n ?? 0),
      knownUsers:     Number(counts[7][0]?.n ?? 0),
    });
  } catch (err) {
    res.status(500).json({ error: "internal_error" });
  }
});

// ── POST /admin/reset-data ────────────────────────────────────────────────────
// Clears ALL game data. Money lives in the Discord bot so is unaffected.
// Tables kept: auth_codes (sessions), msg_config (phone counter)
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
      await rawQuery(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
    }
    await rawQuery(`UPDATE msg_config SET value = '1001' WHERE key = 'next_phone'`);
    logger.info({ admin: admin.username }, "Full data reset performed");
    res.json({ ok: true, message: "تم تصفير جميع البيانات بنجاح", tablesCleared: tables.length });
  } catch (err) {
    logger.error({ err }, "Data reset failed");
    res.status(500).json({ error: "internal_error", message: String((err as Error).message) });
  }
});

export default router;
