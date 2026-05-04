import { Router, type Request, type Response } from "express";
import { getSql } from "../lib/db";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { findGuildMemberByUsername } from "../lib/discord";

function requireUser(req: Request, res: Response) {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user) { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

const router = Router();
const ADMIN = "n16q";

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const BOT_BASE = () => (process.env["AFMOD_BOT_URL"] || "").replace(/\/$/, "");
const BOT_KEY  = () => process.env["AFMOD_BOT_API_KEY"] || "";

async function botPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; status?: number; data?: Record<string, unknown>; networkError?: boolean }> {
  const base = BOT_BASE();
  if (!base) return { ok: true };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    const r = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AFMOD-API-Key": BOT_KEY() },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = await r.json().catch(() => ({})) as Record<string, unknown>;
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, networkError: true };
  }
}

async function resolveUser(rawUsername: string): Promise<{ user_id: string; username: string; display_name: string } | null> {
  const sql = getSql();
  const normalized = rawUsername.trim().toLowerCase().replace(/^@+/, "");
  if (!normalized) return null;

  const profRows = await sql`SELECT user_id, username, display_name FROM tw_profiles WHERE username = ${normalized}`;
  if (profRows.length) {
    const p = profRows[0] as any;
    return { user_id: p.user_id, username: p.username, display_name: p.display_name };
  }

  const knownRows = await sql`SELECT user_id, username, display_name FROM known_users WHERE lower(username) = ${normalized}`;
  if (knownRows.length) {
    const k = knownRows[0] as any;
    return { user_id: k.user_id, username: k.username, display_name: k.display_name };
  }

  try {
    const member = await findGuildMemberByUsername(normalized);
    if (member) {
      await sql`
        INSERT INTO known_users (user_id, username, display_name, avatar_url, last_seen_at)
        VALUES (${member.id}, ${member.username}, ${member.displayName}, ${member.avatarUrl}, ${Date.now()})
        ON CONFLICT (user_id) DO UPDATE SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url,
          last_seen_at = EXCLUDED.last_seen_at
      `;
      return { user_id: member.id, username: member.username, display_name: member.displayName };
    }
  } catch {
    // Discord API unavailable — silently skip
  }

  return null;
}

router.get("/gangs", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangs = await sql`
    SELECT id, name, color, logo_base64, treasury, radius_pct, president_username, president_display_name,
           vp_username, vp_display_name, created_at
    FROM gangs ORDER BY created_at DESC
  `;
  const counts = await sql`SELECT gang_id, COUNT(*) as cnt FROM gang_members GROUP BY gang_id`;
  const countMap: Record<string, number> = {};
  for (const c of counts as any[]) countMap[c.gang_id] = Number(c.cnt);
  res.json((gangs as any[]).map(g => ({ ...g, memberCount: countMap[g.id] || 0 })));
});

router.get("/gangs/sprays", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const sprays = await sql`
    SELECT s.id, s.gang_id, s.x, s.y, s.sprayed_at,
           g.name as gang_name, g.color, g.logo_base64, g.radius_pct
    FROM gang_sprays s JOIN gangs g ON g.id = s.gang_id
    ORDER BY s.gang_id, s.sprayed_at ASC
  `;
  res.json(sprays);
});

router.get("/gangs/mine", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const membership = await sql`SELECT * FROM gang_members WHERE user_id = ${user.id}`;
  if (!membership.length) { res.json(null); return; }
  const m = membership[0] as any;
  res.json({ gangId: m.gang_id, role: m.role });
});

router.get("/gangs/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const membership = await sql`SELECT * FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${user.id}`;
  if (!isAdmin && !membership.length) { res.status(403).json({ error: "not_member" }); return; }

  const [members, weapons, log, sprays, treasuryLog, resourceRows] = await Promise.all([
    sql`SELECT * FROM gang_members WHERE gang_id = ${gang.id} ORDER BY CASE role WHEN 'president' THEN 0 WHEN 'vp' THEN 1 ELSE 2 END, joined_at ASC`,
    sql`SELECT * FROM gang_weapons WHERE gang_id = ${gang.id} ORDER BY added_at DESC`,
    sql`SELECT * FROM gang_log WHERE gang_id = ${gang.id} ORDER BY logged_at DESC LIMIT 60`,
    sql`SELECT * FROM gang_sprays WHERE gang_id = ${gang.id} ORDER BY sprayed_at ASC`,
    sql`SELECT * FROM gang_treasury_log WHERE gang_id = ${gang.id} ORDER BY logged_at DESC LIMIT 40`,
    sql`SELECT * FROM gang_resources WHERE gang_id = ${gang.id}`,
  ]);

  const gangResources = resourceRows.length ? resourceRows[0] as any : { steel: 0, aluminum: 0, plastic: 0, iron: 0, coal: 0, weapons: 0 };

  const userRole = isAdmin ? "admin" : ((membership[0] as any)?.role || "member");
  res.json({ gang, members, weapons, log, sprays, treasuryLog, userRole, gangResources });
});

router.get("/gangs/:id/player-resources", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const rows = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  if (!rows.length) {
    res.json({ steel: 0, aluminum: 0, plastic: 0, iron: 0, coal: 0, weapon_count: 0 });
    return;
  }
  const r = rows[0] as any;
  res.json({ steel: r.steel, aluminum: r.aluminum, plastic: r.plastic, iron: r.iron, coal: r.coal, weapon_count: r.weapon_count || 0 });
});

router.post("/gangs", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN) { res.status(403).json({ error: "forbidden" }); return; }

  const { name, presidentUsername, vpUsername, color, logoBase64 } = req.body as any;
  if (!name?.trim() || !presidentUsername?.trim()) {
    res.status(400).json({ error: "name and presidentUsername required" }); return;
  }

  const sql = getSql();
  const pres = await resolveUser(presidentUsername);
  if (!pres) { res.status(404).json({ error: "president_not_found: " + presidentUsername }); return; }

  let vpId = "", vpUname = "", vpDname = "";
  if (vpUsername?.trim()) {
    const vp = await resolveUser(vpUsername);
    if (!vp) { res.status(404).json({ error: "vp_not_found: " + vpUsername }); return; }
    vpId = vp.user_id; vpUname = vp.username; vpDname = vp.display_name;
  }

  const id = genId();
  const now = Date.now();
  await sql`
    INSERT INTO gangs (id, name, president_id, president_username, president_display_name,
                       vp_id, vp_username, vp_display_name, color, logo_base64, treasury, radius_pct, created_at, created_by)
    VALUES (${id}, ${name.trim()}, ${pres.user_id}, ${pres.username}, ${pres.display_name},
            ${vpId}, ${vpUname}, ${vpDname}, ${color || "#ef4444"}, ${logoBase64 || null}, ${0}, ${0.08}, ${now}, ${user.id})
  `;
  await sql`
    INSERT INTO gang_members (gang_id, user_id, username, display_name, role, joined_at)
    VALUES (${id}, ${pres.user_id}, ${pres.username}, ${pres.display_name}, 'president', ${now})
    ON CONFLICT (gang_id, user_id) DO UPDATE SET role = 'president', username = ${pres.username}, display_name = ${pres.display_name}
  `;
  if (vpId) {
    await sql`
      INSERT INTO gang_members (gang_id, user_id, username, display_name, role, joined_at)
      VALUES (${id}, ${vpId}, ${vpUname}, ${vpDname}, 'vp', ${now})
      ON CONFLICT (gang_id, user_id) DO UPDATE SET role = 'vp'
    `;
  }
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${id}, 'create', ${user.username}, ${`تأسيس عصابة "${name.trim()}" بواسطة المشرف`}, ${now})`;

  res.json({ id, name: name.trim() });
});

router.put("/gangs/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const { name, color, logoBase64, vpUsername, radiusPct } = req.body as any;
  let vpId = gang.vp_id, vpUname = gang.vp_username, vpDname = gang.vp_display_name;

  if ((isPres || isAdmin) && vpUsername !== undefined) {
    if (!vpUsername) {
      if (gang.vp_id) await sql`DELETE FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${gang.vp_id} AND role = 'vp'`;
      vpId = ""; vpUname = ""; vpDname = "";
    } else {
      const vp = await resolveUser(vpUsername);
      if (!vp) { res.status(404).json({ error: "vp_not_found" }); return; }
      vpId = vp.user_id; vpUname = vp.username; vpDname = vp.display_name;
      await sql`
        INSERT INTO gang_members (gang_id, user_id, username, display_name, role, joined_at)
        VALUES (${gang.id}, ${vpId}, ${vpUname}, ${vpDname}, 'vp', ${Date.now()})
        ON CONFLICT (gang_id, user_id) DO UPDATE SET role = 'vp', username = ${vpUname}, display_name = ${vpDname}
      `;
    }
  }

  const newRadius = radiusPct !== undefined ? Math.min(0.18, Math.max(0.04, Number(radiusPct))) : (gang.radius_pct || 0.08);

  await sql`
    UPDATE gangs SET
      name = ${(isPres || isAdmin) ? (name ?? gang.name) : gang.name},
      color = ${(isPres || isAdmin) ? (color ?? gang.color) : gang.color},
      logo_base64 = ${logoBase64 !== undefined ? logoBase64 : gang.logo_base64},
      radius_pct = ${newRadius},
      vp_id = ${vpId}, vp_username = ${vpUname}, vp_display_name = ${vpDname}
    WHERE id = ${gang.id}
  `;
  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'update', ${user.username}, ${"تم تحديث بيانات العصابة"}, ${now})`;
  res.json({ ok: true });
});

router.delete("/gangs/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN) { res.status(403).json({ error: "forbidden" }); return; }
  const sql = getSql();
  const id = req.params.id;
  await Promise.all([
    sql`DELETE FROM gang_members WHERE gang_id = ${id}`,
    sql`DELETE FROM gang_weapons WHERE gang_id = ${id}`,
    sql`DELETE FROM gang_log WHERE gang_id = ${id}`,
    sql`DELETE FROM gang_treasury_log WHERE gang_id = ${id}`,
    sql`DELETE FROM gang_sprays WHERE gang_id = ${id}`,
    sql`DELETE FROM gang_resources WHERE gang_id = ${id}`,
  ]);
  await sql`DELETE FROM gangs WHERE id = ${id}`;
  res.json({ ok: true });
});

router.post("/gangs/:id/members", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const { memberUsername } = req.body as any;
  if (!memberUsername?.trim()) { res.status(400).json({ error: "memberUsername required" }); return; }

  const prof = await resolveUser(memberUsername);
  if (!prof) { res.status(404).json({ error: "user_not_found" }); return; }

  const existMembership = await sql`SELECT * FROM gang_members WHERE user_id = ${prof.user_id}`;
  if (existMembership.length && (existMembership[0] as any).gang_id !== gang.id) {
    res.status(409).json({ error: "user_in_another_gang" }); return;
  }

  const now = Date.now();
  await sql`
    INSERT INTO gang_members (gang_id, user_id, username, display_name, role, joined_at)
    VALUES (${gang.id}, ${prof.user_id}, ${prof.username}, ${prof.display_name}, 'member', ${now})
    ON CONFLICT (gang_id, user_id) DO NOTHING
  `;
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'add_member', ${user.username}, ${`تمت إضافة @${prof.username} للعصابة`}, ${now})`;
  res.json({ ok: true });
});

router.delete("/gangs/:id/members/:userId", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  const isSelf = user.id === req.params.userId;
  if (!isAdmin && !isPres && !isVP && !isSelf) { res.status(403).json({ error: "forbidden" }); return; }
  if (req.params.userId === gang.president_id && !isAdmin) {
    res.status(400).json({ error: "cannot_remove_president" }); return;
  }

  const targetRows = await sql`SELECT * FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${req.params.userId}`;
  if (!targetRows.length) { res.status(404).json({ error: "not_member" }); return; }
  const target = targetRows[0] as any;

  await sql`DELETE FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${req.params.userId}`;
  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'remove_member', ${user.username}, ${`تمت إزالة @${target.username} من العصابة`}, ${now})`;
  res.json({ ok: true });
});

// ── Treasury ────────────────────────────────────────────────────────────────

router.post("/gangs/:id/treasury/deposit", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isMember = (await sql`SELECT 1 FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${user.id}`).length > 0;
  const isAdmin = user.username === ADMIN;
  if (!isAdmin && !isMember) { res.status(403).json({ error: "forbidden" }); return; }

  const amt = Number((req.body as any).amount);
  if (!amt || amt <= 0 || !Number.isFinite(amt)) { res.status(400).json({ error: "invalid_amount" }); return; }

  // Deduct from player's in-game balance via bot
  const botResult = await botPost("/afmod/gang-deposit", {
    userId: user.id,
    username: user.username,
    amount: amt,
    gangId: gang.id,
    gangName: gang.name,
  });
  if (!botResult.ok) {
    if (botResult.networkError || !botResult.status || botResult.status === 404 || botResult.status === 503) {
      res.status(503).json({ error: "bot_unreachable", message: "تعذّر الاتصال بالبوت — تأكد أن البوت يعمل وأن endpoint /afmod/gang-deposit مضاف" });
    } else {
      res.status(402).json({ error: "insufficient_balance", message: "رصيدك غير كافٍ في اللعبة" });
    }
    return;
  }

  const note = String((req.body as any).note || "").slice(0, 200);
  const now = Date.now();
  await sql`UPDATE gangs SET treasury = treasury + ${amt} WHERE id = ${gang.id}`;
  await sql`INSERT INTO gang_treasury_log (gang_id, type, amount, actor_username, note, logged_at)
    VALUES (${gang.id}, 'deposit', ${amt}, ${user.username}, ${note || "إيداع من لاعب"}, ${now})`;
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'deposit', ${user.username}, ${`إيداع $${amt.toLocaleString("en-US")} في الخزينة${note ? " — " + note : ""}`}, ${now})`;

  const updated = await sql`SELECT treasury FROM gangs WHERE id = ${gang.id}`;
  res.json({ treasury: Number((updated[0] as any).treasury) });
});

router.post("/gangs/:id/treasury/withdraw", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const amt = Number((req.body as any).amount);
  if (!amt || amt <= 0 || !Number.isFinite(amt)) { res.status(400).json({ error: "invalid_amount" }); return; }
  if (Number(gang.treasury) < amt) { res.status(400).json({ error: "insufficient_funds" }); return; }

  const note = String((req.body as any).note || "").slice(0, 200);
  const now = Date.now();

  // Deduct from treasury first
  await sql`UPDATE gangs SET treasury = treasury - ${amt} WHERE id = ${gang.id}`;
  await sql`INSERT INTO gang_treasury_log (gang_id, type, amount, actor_username, note, logged_at)
    VALUES (${gang.id}, 'withdraw', ${amt}, ${user.username}, ${note || "سحب من الخزينة"}, ${now})`;
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'withdraw', ${user.username}, ${`سحب $${amt.toLocaleString("en-US")} من الخزينة${note ? " — " + note : ""}`}, ${now})`;

  // Add to player's in-game balance via bot (best-effort)
  await botPost("/afmod/gang-withdraw", {
    userId: user.id,
    username: user.username,
    amount: amt,
    gangId: gang.id,
    gangName: gang.name,
  });

  const updated = await sql`SELECT treasury FROM gangs WHERE id = ${gang.id}`;
  res.json({ treasury: Number((updated[0] as any).treasury) });
});

// ── Resources ───────────────────────────────────────────────────────────────

router.post("/gangs/:id/resources/deposit", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isMember = (await sql`SELECT 1 FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${user.id}`).length > 0;
  const isAdmin = user.username === ADMIN;
  if (!isAdmin && !isMember) { res.status(403).json({ error: "forbidden" }); return; }

  const { steel = 0, aluminum = 0, plastic = 0, iron = 0, coal = 0 } = req.body as any;
  const amounts = { steel: Math.max(0, Math.floor(Number(steel))), aluminum: Math.max(0, Math.floor(Number(aluminum))), plastic: Math.max(0, Math.floor(Number(plastic))), iron: Math.max(0, Math.floor(Number(iron))), coal: Math.max(0, Math.floor(Number(coal))) };
  const total = amounts.steel + amounts.aluminum + amounts.plastic + amounts.iron + amounts.coal;
  if (total === 0) { res.status(400).json({ error: "no_resources_specified" }); return; }

  // Check player has enough
  const playerRows = await sql`SELECT * FROM manufacture_resources WHERE user_id = ${user.id}`;
  if (!playerRows.length) { res.status(400).json({ error: "no_player_resources" }); return; }
  const p = playerRows[0] as any;

  if (p.steel < amounts.steel || p.aluminum < amounts.aluminum || p.plastic < amounts.plastic || p.iron < amounts.iron || p.coal < amounts.coal) {
    res.status(400).json({ error: "insufficient_resources" }); return;
  }

  // Deduct from player
  await sql`
    UPDATE manufacture_resources SET
      steel = steel - ${amounts.steel},
      aluminum = aluminum - ${amounts.aluminum},
      plastic = plastic - ${amounts.plastic},
      iron = iron - ${amounts.iron},
      coal = coal - ${amounts.coal}
    WHERE user_id = ${user.id}
  `;

  // Add to gang
  await sql`
    INSERT INTO gang_resources (gang_id, steel, aluminum, plastic, iron, coal)
    VALUES (${gang.id}, ${amounts.steel}, ${amounts.aluminum}, ${amounts.plastic}, ${amounts.iron}, ${amounts.coal})
    ON CONFLICT (gang_id) DO UPDATE SET
      steel = gang_resources.steel + ${amounts.steel},
      aluminum = gang_resources.aluminum + ${amounts.aluminum},
      plastic = gang_resources.plastic + ${amounts.plastic},
      iron = gang_resources.iron + ${amounts.iron},
      coal = gang_resources.coal + ${amounts.coal}
  `;

  const now = Date.now();
  const parts = Object.entries(amounts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ");
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'resource_deposit', ${user.username}, ${`إيداع موارد: ${parts}`}, ${now})`;

  res.json({ ok: true });
});

router.post("/gangs/:id/resources/withdraw", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const { steel = 0, aluminum = 0, plastic = 0, iron = 0, coal = 0 } = req.body as any;
  const amounts = { steel: Math.max(0, Math.floor(Number(steel))), aluminum: Math.max(0, Math.floor(Number(aluminum))), plastic: Math.max(0, Math.floor(Number(plastic))), iron: Math.max(0, Math.floor(Number(iron))), coal: Math.max(0, Math.floor(Number(coal))) };
  const total = amounts.steel + amounts.aluminum + amounts.plastic + amounts.iron + amounts.coal;
  if (total === 0) { res.status(400).json({ error: "no_resources_specified" }); return; }

  // Check gang has enough
  const gangResRows = await sql`SELECT * FROM gang_resources WHERE gang_id = ${gang.id}`;
  const gr = gangResRows.length ? gangResRows[0] as any : { steel: 0, aluminum: 0, plastic: 0, iron: 0, coal: 0 };
  if (gr.steel < amounts.steel || gr.aluminum < amounts.aluminum || gr.plastic < amounts.plastic || gr.iron < amounts.iron || gr.coal < amounts.coal) {
    res.status(400).json({ error: "insufficient_gang_resources" }); return;
  }

  // Deduct from gang
  await sql`
    UPDATE gang_resources SET
      steel = steel - ${amounts.steel},
      aluminum = aluminum - ${amounts.aluminum},
      plastic = plastic - ${amounts.plastic},
      iron = iron - ${amounts.iron},
      coal = coal - ${amounts.coal}
    WHERE gang_id = ${gang.id}
  `;

  // Add to player
  await sql`
    INSERT INTO manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at)
    VALUES (${user.id}, ${user.username}, ${amounts.steel}, ${amounts.aluminum}, ${amounts.plastic}, ${amounts.iron}, ${amounts.coal}, 0)
    ON CONFLICT (user_id) DO UPDATE SET
      steel = manufacture_resources.steel + ${amounts.steel},
      aluminum = manufacture_resources.aluminum + ${amounts.aluminum},
      plastic = manufacture_resources.plastic + ${amounts.plastic},
      iron = manufacture_resources.iron + ${amounts.iron},
      coal = manufacture_resources.coal + ${amounts.coal}
  `;

  const now = Date.now();
  const parts = Object.entries(amounts).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(", ");
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'resource_withdraw', ${user.username}, ${`سحب موارد: ${parts}`}, ${now})`;

  res.json({ ok: true });
});

// ── Weapons ─────────────────────────────────────────────────────────────────

router.post("/gangs/:id/weapons", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const weaponName = String((req.body as any).weaponName || "").trim();
  if (!weaponName) { res.status(400).json({ error: "weaponName required" }); return; }
  const qty = Math.max(1, Number((req.body as any).quantity) || 1);

  const now = Date.now();
  await sql`INSERT INTO gang_weapons (gang_id, weapon_name, quantity, added_by, added_at)
    VALUES (${gang.id}, ${weaponName}, ${qty}, ${user.username}, ${now})`;
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'add_weapon', ${user.username}, ${`إضافة ${qty}× ${weaponName}`}, ${now})`;
  res.json({ ok: true });
});

router.post("/gangs/:id/weapons/transfer", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isMember = (await sql`SELECT 1 FROM gang_members WHERE gang_id = ${gang.id} AND user_id = ${user.id}`).length > 0;
  const isAdmin = user.username === ADMIN;
  if (!isAdmin && !isMember) { res.status(403).json({ error: "forbidden" }); return; }

  const qty = Math.max(1, Math.floor(Number((req.body as any).quantity) || 1));

  // Check player has enough weapons
  const playerRows = await sql`SELECT weapon_count FROM manufacture_resources WHERE user_id = ${user.id}`;
  const playerWeapons = playerRows.length ? Number((playerRows[0] as any).weapon_count || 0) : 0;
  if (playerWeapons < qty) { res.status(400).json({ error: "insufficient_weapons" }); return; }

  // Deduct from player
  await sql`UPDATE manufacture_resources SET weapon_count = weapon_count - ${qty} WHERE user_id = ${user.id}`;

  // Add to gang resources
  await sql`
    INSERT INTO gang_resources (gang_id, weapons)
    VALUES (${gang.id}, ${qty})
    ON CONFLICT (gang_id) DO UPDATE SET weapons = gang_resources.weapons + ${qty}
  `;

  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'weapon_deposit', ${user.username}, ${`إيداع ${qty} سلاح في مستودع العصابة`}, ${now})`;

  res.json({ ok: true });
});

router.post("/gangs/:id/weapons/withdraw", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const qty = Math.max(1, Math.floor(Number((req.body as any).quantity) || 1));

  const gangResRows = await sql`SELECT weapons FROM gang_resources WHERE gang_id = ${gang.id}`;
  const gangWeapons = gangResRows.length ? Number((gangResRows[0] as any).weapons || 0) : 0;
  if (gangWeapons < qty) { res.status(400).json({ error: "insufficient_gang_weapons" }); return; }

  await sql`UPDATE gang_resources SET weapons = weapons - ${qty} WHERE gang_id = ${gang.id}`;
  await sql`
    INSERT INTO manufacture_resources (user_id, discord_username, weapon_count, last_mined_at)
    VALUES (${user.id}, ${user.username}, ${qty}, 0)
    ON CONFLICT (user_id) DO UPDATE SET weapon_count = manufacture_resources.weapon_count + ${qty}
  `;

  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'weapon_withdraw', ${user.username}, ${`سحب ${qty} سلاح من مستودع العصابة`}, ${now})`;

  res.json({ ok: true });
});

router.delete("/gangs/:id/weapons/:weaponId", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  const isVP = gang.vp_id === user.id;
  if (!isAdmin && !isPres && !isVP) { res.status(403).json({ error: "forbidden" }); return; }

  const weaponRows = await sql`SELECT * FROM gang_weapons WHERE id = ${req.params.weaponId} AND gang_id = ${gang.id}`;
  if (!weaponRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const weapon = weaponRows[0] as any;

  await sql`DELETE FROM gang_weapons WHERE id = ${req.params.weaponId}`;
  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'remove_weapon', ${user.username}, ${`إزالة ${weapon.weapon_name}`}, ${now})`;
  res.json({ ok: true });
});

// ── Spray / Territory ────────────────────────────────────────────────────────

router.post("/gangs/:id/spray", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  if (!isAdmin && !isPres) { res.status(403).json({ error: "presidents_only" }); return; }

  const x = Number((req.body as any).x);
  const y = Number((req.body as any).y);
  if (isNaN(x) || isNaN(y) || x < 0 || x > 1 || y < 0 || y > 1) {
    res.status(400).json({ error: "x and y must be 0-1 normalized coords" }); return;
  }

  const existingSprays = await sql`SELECT * FROM gang_sprays WHERE gang_id = ${gang.id}`;
  if (existingSprays.length >= 3) { res.status(400).json({ error: "max_sprays_reached" }); return; }

  const SPRAY_COST = 10000;
  if (Number(gang.treasury) < SPRAY_COST) {
    res.status(400).json({ error: "insufficient_treasury", need: SPRAY_COST, have: Number(gang.treasury) }); return;
  }

  const allOtherSprays = await sql`SELECT * FROM gang_sprays WHERE gang_id != ${gang.id}`;
  const MIN_DIST = 0.06;
  for (const spray of allOtherSprays as any[]) {
    const dx = Number(spray.x) - x;
    const dy = Number(spray.y) - y;
    if (Math.sqrt(dx * dx + dy * dy) < MIN_DIST) {
      res.status(409).json({ error: "overlapping_spray" }); return;
    }
  }

  const now = Date.now();
  await sql`UPDATE gangs SET treasury = treasury - ${SPRAY_COST} WHERE id = ${gang.id}`;
  const inserted = await sql`
    INSERT INTO gang_sprays (gang_id, x, y, sprayed_at) VALUES (${gang.id}, ${x}, ${y}, ${now}) RETURNING id
  `;
  await sql`INSERT INTO gang_treasury_log (gang_id, type, amount, actor_username, note, logged_at)
    VALUES (${gang.id}, 'spray', ${SPRAY_COST}, ${user.username}, ${"تكلفة نقطة رش"}, ${now})`;
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'spray', ${user.username}, ${"إضافة نقطة رش — تكلفة $10,000"}, ${now})`;

  const treasury = Number(gang.treasury) - SPRAY_COST;
  res.json({ ok: true, sprayId: (inserted[0] as any).id, treasury });
});

router.delete("/gangs/:id/spray/:sprayId", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const gangRows = await sql`SELECT * FROM gangs WHERE id = ${req.params.id}`;
  if (!gangRows.length) { res.status(404).json({ error: "not_found" }); return; }
  const gang = gangRows[0] as any;

  const isAdmin = user.username === ADMIN;
  const isPres = gang.president_id === user.id;
  if (!isAdmin && !isPres) { res.status(403).json({ error: "forbidden" }); return; }

  await sql`DELETE FROM gang_sprays WHERE id = ${req.params.sprayId} AND gang_id = ${gang.id}`;
  const now = Date.now();
  await sql`INSERT INTO gang_log (gang_id, action, actor_username, details, logged_at)
    VALUES (${gang.id}, 'remove_spray', ${user.username}, ${"إزالة نقطة رش"}, ${now})`;
  res.json({ ok: true });
});

export default router;
