import { getSql } from "./db";
import { logger } from "./logger";

export async function creditBankOwner(amount: number, reason: string): Promise<void> {
  if (amount <= 0) return;
  try {
    const sql = getSql();
    const [owner] = await sql`SELECT user_id FROM bank_owner ORDER BY purchased_at DESC LIMIT 1`;
    if (!owner) return;
    const bankOwnerId = owner.user_id as string;
    const now = Date.now();
    await sql`
      INSERT INTO business_state
        (user_id, business_id, business_type, inventory_pct, last_refill_at, accumulated_profit, last_sync_at, weekly_bonus_at)
      VALUES
        (${bankOwnerId}, 'city-bank', 'bank', 100, ${now}, ${amount}, ${now}, ${now})
      ON CONFLICT (user_id, business_id, business_type) DO UPDATE SET
        accumulated_profit = business_state.accumulated_profit + ${amount},
        last_sync_at       = ${now}
    `;
    await sql`
      INSERT INTO business_profit_log (user_id, business_id, business_type, amount, note, logged_at)
      VALUES (${bankOwnerId}, 'city-bank', 'bank', ${amount}, ${reason}, ${now})
    `;
  } catch (err) {
    logger.warn({ err, amount, reason }, "Failed to credit bank owner");
  }
}
