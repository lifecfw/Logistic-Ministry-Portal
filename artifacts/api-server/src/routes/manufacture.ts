import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { assignRole } from "../lib/discord";
import { logger } from "../lib/logger";

const router = Router();

const MINE_COOLDOWN_MS = 10 * 60 * 1000;
const CRAFT_ROLE_ID    = "1496247283661013132";
const CRAFT_REQUIRED   = { steel: 5, aluminum: 3, plastic: 2, iron: 5, coal: 4 };
const ADMIN_USERS      = ["n16q", "4s7b"];
const VIP_INFINITE     = ["4s7b"];
const MAX_TRANSFER     = 999;

function requireUser(req: Request, res: Response) {
  const cookies   = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user)      { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

async function botPost(path: string, body: unknown) {
  const BOT_BASE_URL = process.env.AFMOD_BOT_URL    || "";
  const BOT_API_KEY  = process.env.AFMOD_BOT_API_KEY || "";
  if (!BOT_BASE_URL || !BOT_API_KEY) return { ok: false, status: 503, data: { message: "Bot not configured" } as Record<string, unknown> };
  try {
    const r = await fetch(BOT_BASE_URL.replace(/\/$/, "") + path, {
      method:  "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_API_KEY },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(8_000),
    });
    const data = await r.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    logger.warn({ err, path }, "Bot unreachable");
    return { ok: false, status: 503, data: { message: "البوت غير متصل" } as Record<string, unknown> };
  }
}

// Lookup a user by discordUsername across our tables
async function findTargetUserId(sql: ReturnType<typeof getSql>, username: string): Promise<string | null> {
  const [r1] = await sql`SELECT user_id FROM manufacture_resources WHERE discord_username = ${username}`;
  if (r1) return r1.user_id as string;
  const [r2] = await sql`SELECT user_id FROM tw_profiles WHERE discord_username = ${username}`;
  if (r2) return r2.user_id as string;
  return null;
}

// ── GET /manufacture/status ───────────────────────────────────────────────────
router.get("/manufacture/status", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();

  const [resRow]   = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  const [tableRow] = await sql`SELECT user_id FROM manufacture_tables  WHERE user_id = ${user.id}`;

  const weaponCount = Number(resRow?.weapon_count ?? 0);

  res.json({
    resources: {
      steel:    Number(resRow?.steel    ?? 0),
      aluminum: Number(resRow?.aluminum ?? 0),
      plastic:  Number(resRow?.plastic  ?? 0),
      iron:     Number(resRow?.iron     ?? 0),
      coal:     Number(resRow?.coal     ?? 0),
    },
    lastMinedAt:      Number(resRow?.last_mined_at ?? 0),
    hasTable:         !!tableRow,
    hasCraftedWeapon: weaponCount > 0,
    weaponCount,
    craftRequired:    CRAFT_REQUIRED,
  });
});

// ── POST /manufacture/mine ────────────────────────────────────────────────────
router.post("/manufacture/mine", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();
  const now = Date.now();

  const isAdmin  = ADMIN_USERS.includes(user.username);
  const isVipInf = VIP_INFINITE.includes(user.username);

  if (isAdmin) {
    const INF = 999_999;
    const gain = isVipInf ? INF : 9999;
    const gainObj = { steel: gain, aluminum: gain, plastic: gain, iron: gain, coal: gain };

    const [resRow] = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
    if (resRow) {
      if (isVipInf) {
        await sql`
          UPDATE manufacture_resources SET
            steel = ${INF}, aluminum = ${INF}, plastic = ${INF},
            iron = ${INF}, coal = ${INF},
            discord_username = ${user.username}, last_mined_at = ${now}
          WHERE user_id = ${user.id}
        `;
      } else {
        await sql`
          UPDATE manufacture_resources SET
            steel = steel + 9999, aluminum = aluminum + 9999, plastic = plastic + 9999,
            iron = iron + 9999, coal = coal + 9999,
            discord_username = ${user.username}, last_mined_at = ${now}
          WHERE user_id = ${user.id}
        `;
      }
    } else {
      await sql`
        INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at)
        VALUES (${user.id}, ${user.username}, ${gain}, ${gain}, ${gain}, ${gain}, ${gain}, ${now})
      `;
    }
    const [updated] = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
    res.json({
      ok: true, gained: gainObj, isAdmin: true, isVip: isVipInf,
      resources: {
        steel: Number(updated.steel), aluminum: Number(updated.aluminum),
        plastic: Number(updated.plastic), iron: Number(updated.iron), coal: Number(updated.coal),
      },
      lastMinedAt: now,
    });
    return;
  }

  const [resRow]    = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  const lastMinedAt = Number(resRow?.last_mined_at ?? 0);

  if (lastMinedAt > 0 && now - lastMinedAt < MINE_COOLDOWN_MS) {
    res.status(429).json({ error: "cooldown", nextAt: lastMinedAt + MINE_COOLDOWN_MS });
    return;
  }

  const gained = {
    steel:    Math.floor(Math.random() * 3) + 1,
    aluminum: Math.floor(Math.random() * 2) + 1,
    plastic:  Math.floor(Math.random() * 3) + 1,
    iron:     Math.floor(Math.random() * 3) + 2,
    coal:     Math.floor(Math.random() * 4) + 2,
  };

  if (resRow) {
    await sql`
      UPDATE manufacture_resources SET
        steel         = steel    + ${gained.steel},
        aluminum      = aluminum + ${gained.aluminum},
        plastic       = plastic  + ${gained.plastic},
        iron          = iron     + ${gained.iron},
        coal          = coal     + ${gained.coal},
        discord_username = ${user.username},
        last_mined_at = ${now}
      WHERE user_id = ${user.id}
    `;
  } else {
    await sql`
      INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at)
      VALUES (${user.id}, ${user.username}, ${gained.steel}, ${gained.aluminum}, ${gained.plastic}, ${gained.iron}, ${gained.coal}, ${now})
    `;
  }

  const [updated] = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  res.json({
    ok: true,
    gained,
    resources: {
      steel:    Number(updated.steel),
      aluminum: Number(updated.aluminum),
      plastic:  Number(updated.plastic),
      iron:     Number(updated.iron),
      coal:     Number(updated.coal),
    },
    lastMinedAt: now,
  });
});

// ── POST /manufacture/buy-table ───────────────────────────────────────────────
router.post("/manufacture/buy-table", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();

  const [existing] = await sql`SELECT user_id FROM manufacture_tables WHERE user_id = ${user.id}`;
  if (existing) {
    res.status(409).json({ error: "already_owned", message: "لديك طاولة تصنيع بالفعل" });
    return;
  }

  const result = await botPost("/afmod/buy-crafting-table", { userId: user.id });
  if (!result.ok) {
    res.status(result.status === 402 ? 402 : 503).json({
      error:   result.status === 402 ? "insufficient_funds" : "payment_failed",
      message: (result.data.message as string) || "فشلت عملية الشراء",
    });
    return;
  }

  const now = Date.now();
  await sql`INSERT INTO manufacture_tables (user_id, purchased_at) VALUES (${user.id}, ${now}) ON CONFLICT DO NOTHING`;
  res.json({ ok: true });
});

// ── POST /manufacture/craft-weapon ───────────────────────────────────────────
// Allows multiple crafts — table is consumed on each craft, user must re-buy
router.post("/manufacture/craft-weapon", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();

  const [tableRow] = await sql`SELECT user_id FROM manufacture_tables WHERE user_id = ${user.id}`;
  if (!tableRow) {
    res.status(403).json({ error: "no_table", message: "تحتاج طاولة تصنيع أولاً" }); return;
  }

  const [resRow] = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  const resources = {
    steel:    Number(resRow?.steel    ?? 0),
    aluminum: Number(resRow?.aluminum ?? 0),
    plastic:  Number(resRow?.plastic  ?? 0),
    iron:     Number(resRow?.iron     ?? 0),
    coal:     Number(resRow?.coal     ?? 0),
  };

  const missing: string[] = [];
  (Object.entries(CRAFT_REQUIRED) as [keyof typeof CRAFT_REQUIRED, number][])
    .forEach(([k, v]) => { if (resources[k] < v) missing.push(k); });

  if (missing.length) {
    res.status(403).json({ error: "insufficient_resources", missing, message: "الموارد غير كافية" }); return;
  }

  // Deduct resources
  await sql`
    UPDATE manufacture_resources SET
      steel    = steel    - ${CRAFT_REQUIRED.steel},
      aluminum = aluminum - ${CRAFT_REQUIRED.aluminum},
      plastic  = plastic  - ${CRAFT_REQUIRED.plastic},
      iron     = iron     - ${CRAFT_REQUIRED.iron},
      coal     = coal     - ${CRAFT_REQUIRED.coal},
      weapon_count = weapon_count + 1
    WHERE user_id = ${user.id}
  `;

  // Consume the table (delete it — user must buy a new one for next craft)
  await sql`DELETE FROM manufacture_tables WHERE user_id = ${user.id}`;

  // Also keep legacy weapon record for backward compat
  const now = Date.now();
  await sql`INSERT INTO manufacture_weapons (user_id, crafted_at) VALUES (${user.id}, ${now}) ON CONFLICT DO NOTHING`;

  let roleAssigned = false;
  try { roleAssigned = await assignRole(user.id, CRAFT_ROLE_ID); }
  catch (err) { logger.warn({ err }, "Failed to assign craft role"); }

  const [updated] = await sql`SELECT weapon_count FROM manufacture_resources WHERE user_id = ${user.id}`;
  res.json({ ok: true, roleAssigned, weaponCount: Number(updated?.weapon_count ?? 1) });
});

// ── GET /manufacture/my-weapons ───────────────────────────────────────────────
router.get("/manufacture/my-weapons", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const sql = getSql();
  const [resRow] = await sql`SELECT weapon_count FROM manufacture_resources WHERE user_id = ${user.id}`;
  res.json({ weaponCount: Number(resRow?.weapon_count ?? 0) });
});

// ── POST /manufacture/transfer-resources ─────────────────────────────────────
router.post("/manufacture/transfer-resources", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { targetUsername, steel, aluminum, plastic, iron, coal } = req.body as Record<string, unknown>;
  if (!targetUsername) { res.status(400).json({ error: "targetUsername required" }); return; }

  const s  = Math.max(0, Math.min(MAX_TRANSFER, Number(steel)    || 0));
  const al = Math.max(0, Math.min(MAX_TRANSFER, Number(aluminum) || 0));
  const pl = Math.max(0, Math.min(MAX_TRANSFER, Number(plastic)  || 0));
  const ir = Math.max(0, Math.min(MAX_TRANSFER, Number(iron)     || 0));
  const co = Math.max(0, Math.min(MAX_TRANSFER, Number(coal)     || 0));

  if (!s && !al && !pl && !ir && !co) {
    res.status(400).json({ error: "empty_transfer", message: "أدخل كمية لمادة واحدة على الأقل" }); return;
  }

  const sql = getSql();

  // Get sender resources
  const [senderRow] = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  if (!senderRow) {
    res.status(403).json({ error: "no_resources", message: "ليس لديك موارد" }); return;
  }

  const checks = [
    { name: "فولاذ",    have: Number(senderRow.steel),    need: s  },
    { name: "ألمنيوم", have: Number(senderRow.aluminum), need: al },
    { name: "بلاستيك", have: Number(senderRow.plastic),  need: pl },
    { name: "حديد",    have: Number(senderRow.iron),     need: ir },
    { name: "فحم",     have: Number(senderRow.coal),     need: co },
  ];
  const short = checks.filter(c => c.need > 0 && c.have < c.need);
  if (short.length) {
    res.status(403).json({ error: "insufficient", message: `موارد غير كافية: ${short.map(c => c.name).join("، ")}` }); return;
  }

  // Find target user
  const targetId = await findTargetUserId(sql, String(targetUsername));
  if (!targetId) {
    res.status(404).json({ error: "user_not_found", message: "المستخدم غير موجود أو لم يستخدم المصنع بعد" }); return;
  }

  if (targetId === user.id) {
    res.status(400).json({ error: "self_transfer", message: "لا يمكنك التحويل لنفسك" }); return;
  }

  // Deduct from sender
  await sql`
    UPDATE manufacture_resources SET
      steel    = steel    - ${s},
      aluminum = aluminum - ${al},
      plastic  = plastic  - ${pl},
      iron     = iron     - ${ir},
      coal     = coal     - ${co}
    WHERE user_id = ${user.id}
  `;

  // Credit to receiver (create row if needed)
  const now = Date.now();
  await sql`
    INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at)
    VALUES (${targetId}, ${String(targetUsername)}, ${s}, ${al}, ${pl}, ${ir}, ${co}, ${now})
    ON CONFLICT (user_id) DO UPDATE SET
      steel    = manufacture_resources.steel    + EXCLUDED.steel,
      aluminum = manufacture_resources.aluminum + EXCLUDED.aluminum,
      plastic  = manufacture_resources.plastic  + EXCLUDED.plastic,
      iron     = manufacture_resources.iron     + EXCLUDED.iron,
      coal     = manufacture_resources.coal     + EXCLUDED.coal
  `;

  logger.info({ from: user.username, to: targetUsername, s, al, pl, ir, co }, "Resource transfer");
  res.json({ ok: true, transferred: { steel: s, aluminum: al, plastic: pl, iron: ir, coal: co } });
});

// ── POST /manufacture/transfer-weapon ────────────────────────────────────────
router.post("/manufacture/transfer-weapon", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { targetUsername, count } = req.body as Record<string, unknown>;
  if (!targetUsername) { res.status(400).json({ error: "targetUsername required" }); return; }
  const qty = Math.max(1, Math.min(99, Number(count) || 1));

  const sql = getSql();
  const [senderRow] = await sql`SELECT weapon_count FROM manufacture_resources WHERE user_id = ${user.id}`;
  const senderWeapons = Number(senderRow?.weapon_count ?? 0);

  if (senderWeapons < qty) {
    res.status(403).json({ error: "insufficient_weapons", message: `ليس لديك ما يكفي من الأسلحة (لديك ${senderWeapons})` }); return;
  }

  const targetId = await findTargetUserId(sql, String(targetUsername));
  if (!targetId) {
    res.status(404).json({ error: "user_not_found", message: "المستخدم غير موجود أو لم يستخدم المصنع بعد" }); return;
  }

  if (targetId === user.id) {
    res.status(400).json({ error: "self_transfer", message: "لا يمكنك التحويل لنفسك" }); return;
  }

  // Deduct from sender
  await sql`UPDATE manufacture_resources SET weapon_count = weapon_count - ${qty} WHERE user_id = ${user.id}`;

  // Add to receiver (create row if not exists)
  const now = Date.now();
  await sql`
    INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at, weapon_count)
    VALUES (${targetId}, ${String(targetUsername)}, 0, 0, 0, 0, 0, ${now}, ${qty})
    ON CONFLICT (user_id) DO UPDATE SET
      weapon_count = manufacture_resources.weapon_count + EXCLUDED.weapon_count
  `;

  logger.info({ from: user.username, to: targetUsername, qty }, "Weapon transfer");
  res.json({ ok: true, transferred: qty });
});

// ── POST /manufacture/admin-give ──────────────────────────────────────────────
router.post("/manufacture/admin-give", async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  if (!ADMIN_USERS.includes(user.username)) {
    res.status(403).json({ error: "forbidden", message: "ليس لديك صلاحية" }); return;
  }

  const { targetUsername, steel, aluminum, plastic, iron, coal } = req.body as Record<string, unknown>;
  if (!targetUsername) { res.status(400).json({ error: "targetUsername required" }); return; }

  const s  = Math.max(0, Math.min(999999, Number(steel)    || 0));
  const al = Math.max(0, Math.min(999999, Number(aluminum) || 0));
  const pl = Math.max(0, Math.min(999999, Number(plastic)  || 0));
  const ir = Math.max(0, Math.min(999999, Number(iron)     || 0));
  const co = Math.max(0, Math.min(999999, Number(coal)     || 0));

  const sql = getSql();
  const [resTarget] = await sql`
    SELECT user_id, discord_username FROM manufacture_resources WHERE discord_username = ${String(targetUsername)}
  `;

  if (!resTarget) {
    const [profile] = await sql`SELECT user_id FROM tw_profiles WHERE discord_username = ${String(targetUsername)}`;
    if (!profile) {
      res.status(404).json({ error: "user_not_found", message: "المستخدم غير موجود" });
      return;
    }
    const now = Date.now();
    await sql`
      INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at)
      VALUES (${profile.user_id}, ${String(targetUsername)}, ${s}, ${al}, ${pl}, ${ir}, ${co}, ${now})
      ON CONFLICT (user_id) DO UPDATE SET
        discord_username = EXCLUDED.discord_username,
        steel    = manufacture_resources.steel    + EXCLUDED.steel,
        aluminum = manufacture_resources.aluminum + EXCLUDED.aluminum,
        plastic  = manufacture_resources.plastic  + EXCLUDED.plastic,
        iron     = manufacture_resources.iron     + EXCLUDED.iron,
        coal     = manufacture_resources.coal     + EXCLUDED.coal
    `;
  } else {
    await sql`
      UPDATE manufacture_resources SET
        steel    = steel    + ${s},
        aluminum = aluminum + ${al},
        plastic  = plastic  + ${pl},
        iron     = iron     + ${ir},
        coal     = coal     + ${co}
      WHERE user_id = ${resTarget.user_id}
    `;
  }

  logger.info({ admin: user.username, target: targetUsername, given: { s, al, pl, ir, co } }, "Admin gave resources");
  res.json({ ok: true, given: { steel: s, aluminum: al, plastic: pl, iron: ir, coal: co } });
});

export default router;
