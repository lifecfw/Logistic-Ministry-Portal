import { Router, type IRouter, type Request, type Response } from "express";
import { getSession, SESSION_COOKIE_NAME } from "../lib/sessions";
import { getSql } from "../lib/db";
import express from "express";

const router: IRouter = Router();
router.use(express.json({ limit: "8mb" }));

interface MsgProfile {
  phone: string;
  userId: string;
  name: string;
  familyName: string;
  bio: string;
  avatarBase64: string | null;
  username: string;
  displayName: string;
  updatedAt: string;
}

interface MsgMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  type: "text" | "image";
  timestamp: string;
  senderName?: string;
}

interface MsgGroup {
  id: string;
  name: string;
  avatarBase64: string | null;
  adminId: string;
  members: string[];
  createdAt: string;
}

function rowToProfile(r: any): MsgProfile {
  return {
    userId: r.user_id, phone: r.phone,
    name: r.name || "", familyName: r.family_name || "",
    bio: r.bio || "", avatarBase64: r.avatar_base64 ?? null,
    username: r.username || "", displayName: r.display_name || "",
    updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
  };
}

function rowToMsg(r: any): MsgMessage {
  return {
    id: r.id, from: r.from_id, to: r.to_id, content: r.content,
    type: r.type === "image" ? "image" : "text",
    timestamp: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    senderName: r.sender_name ?? undefined,
  };
}

function rowToGroup(r: any): MsgGroup {
  return {
    id: r.id, name: r.name, avatarBase64: r.avatar_base64 ?? null,
    adminId: r.admin_id, members: (r.members as string[]) || [],
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

function chatKey(id1: string, id2: string): string {
  return [id1, id2].sort().join("~~");
}

function groupKey(groupId: string): string {
  return `group:${groupId}`;
}

function otherUserId(key: string, myId: string): string {
  const parts = key.split("~~");
  return parts[0] === myId ? parts[1] : parts[0];
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function requireUser(req: Request, res: Response) {
  const cookies = req.cookies as Record<string, string> | undefined;
  const sessionId = cookies?.[SESSION_COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ error: "unauthorized" }); return null; }
  const user = getSession(sessionId);
  if (!user) { res.status(401).json({ error: "unauthorized" }); return null; }
  return user;
}

async function getProfileByUserId(userId: string): Promise<MsgProfile | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_profiles WHERE user_id = ${userId}`;
  return rows.length ? rowToProfile(rows[0]) : null;
}

async function getProfileByPhone(phone: string): Promise<MsgProfile | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_profiles WHERE phone = ${phone}`;
  return rows.length ? rowToProfile(rows[0]) : null;
}

async function getAllProfiles(): Promise<Record<string, MsgProfile>> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_profiles`;
  const out: Record<string, MsgProfile> = {};
  for (const r of rows as any[]) {
    const p = rowToProfile(r);
    out[p.userId] = p;
  }
  return out;
}

async function upsertProfile(p: MsgProfile): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO msg_profiles (user_id, phone, name, family_name, bio, avatar_base64, username, display_name, updated_at)
    VALUES (${p.userId}, ${p.phone}, ${p.name}, ${p.familyName}, ${p.bio}, ${p.avatarBase64}, ${p.username}, ${p.displayName}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      name = EXCLUDED.name, family_name = EXCLUDED.family_name, bio = EXCLUDED.bio,
      avatar_base64 = EXCLUDED.avatar_base64, username = EXCLUDED.username,
      display_name = EXCLUDED.display_name, updated_at = NOW()
  `;
}

async function nextPhone(): Promise<string> {
  const sql = getSql();
  const rows = await sql`UPDATE msg_config SET value = (CAST(value AS INT) + 1)::TEXT WHERE key = 'next_phone' RETURNING value`;
  const prev = Number((rows[0] as any).value) - 1;
  return String(prev);
}

async function getChatMessages(key: string, limit = 200): Promise<MsgMessage[]> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_chats WHERE chat_key = ${key} ORDER BY created_at ASC LIMIT ${limit}`;
  return (rows as any[]).map(rowToMsg);
}

async function insertMessage(key: string, msg: MsgMessage): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO msg_chats (chat_key, id, from_id, to_id, content, type, sender_name, created_at)
    VALUES (${key}, ${msg.id}, ${msg.from}, ${msg.to}, ${msg.content}, ${msg.type}, ${msg.senderName ?? null}, ${msg.timestamp})
  `;
}

async function getGroup(id: string): Promise<MsgGroup | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_groups WHERE id = ${id}`;
  return rows.length ? rowToGroup(rows[0]) : null;
}

async function getAllGroups(): Promise<Record<string, MsgGroup>> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM msg_groups`;
  const out: Record<string, MsgGroup> = {};
  for (const r of rows as any[]) {
    const g = rowToGroup(r);
    out[g.id] = g;
  }
  return out;
}

async function upsertGroup(g: MsgGroup): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO msg_groups (id, name, avatar_base64, admin_id, members, created_at)
    VALUES (${g.id}, ${g.name}, ${g.avatarBase64}, ${g.adminId}, ${JSON.stringify(g.members) as any}, ${g.createdAt})
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, avatar_base64 = EXCLUDED.avatar_base64,
      admin_id = EXCLUDED.admin_id, members = EXCLUDED.members
  `;
}

// ── Reserve phone ────────────────────────────────────────────────────────────
router.get("/messages/reserve-phone", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const existing = await getProfileByUserId(user.id);
  if (existing?.phone) { res.json({ phone: existing.phone }); return; }
  const phone = await nextPhone();
  const sql = getSql();
  await sql`
    INSERT INTO msg_profiles (user_id, phone, name, family_name, bio, avatar_base64, username, display_name, updated_at)
    VALUES (${user.id}, ${phone}, '', '', '', NULL, ${user.username}, ${user.displayName}, NOW())
    ON CONFLICT (user_id) DO NOTHING
  `;
  res.json({ phone });
});

// ── My profile ───────────────────────────────────────────────────────────────
router.get("/messages/my-profile", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByUserId(user.id);
  if (!profile || !profile.name) { res.status(404).json({ error: "no_profile" }); return; }
  res.json(profile);
});

// ── Setup / update profile ────────────────────────────────────────────────────
router.post("/messages/setup", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { name, familyName, bio, avatarBase64 } = req.body as {
    name?: string; familyName?: string; bio?: string; avatarBase64?: string;
  };
  if (!name || !name.trim()) { res.status(400).json({ error: "name is required" }); return; }
  let existing = await getProfileByUserId(user.id);
  let phone = existing?.phone;
  if (!phone) { phone = await nextPhone(); }
  const profile: MsgProfile = {
    phone, userId: user.id, name: name.trim(),
    familyName: (familyName || "").trim(), bio: (bio || "").trim(),
    avatarBase64: avatarBase64 ?? existing?.avatarBase64 ?? null,
    username: user.username, displayName: user.displayName,
    updatedAt: new Date().toISOString(),
  };
  await upsertProfile(profile);
  res.json(profile);
});

// ── Profile by phone ─────────────────────────────────────────────────────────
router.get("/messages/profile-by-phone/:phone", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByPhone(req.params.phone);
  if (!profile) { res.status(404).json({ error: "not_found" }); return; }
  const { avatarBase64, ...safe } = profile;
  res.json({ ...safe, avatarBase64: !!avatarBase64 });
});

// ── Avatars ──────────────────────────────────────────────────────────────────
router.get("/messages/avatar/:phone", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByPhone(req.params.phone);
  if (!profile?.avatarBase64) { res.status(404).json({ error: "no_avatar" }); return; }
  res.json({ avatarBase64: profile.avatarBase64 });
});

router.get("/messages/my-avatar", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByUserId(user.id);
  if (!profile?.avatarBase64) { res.status(404).json({ error: "no_avatar" }); return; }
  res.json({ avatarBase64: profile.avatarBase64 });
});

router.get("/messages/group-avatar/:groupId", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.groupId);
  if (!group || !group.avatarBase64) { res.status(404).json({ error: "no_avatar" }); return; }
  if (!group.members.includes(user.id)) { res.status(403).json({ error: "not a member" }); return; }
  res.json({ avatarBase64: group.avatarBase64 });
});

// ── Unified chat list ────────────────────────────────────────────────────────
router.get("/messages/chats", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profiles = await getAllProfiles();
  const groups = await getAllGroups();
  const result: object[] = [];

  // DM chats: find all chats where user.id is in the key
  const sql = getSql();
  const dmRows = await sql`
    SELECT DISTINCT chat_key FROM msg_chats WHERE chat_key LIKE ${"%" + user.id + "%"} AND chat_key NOT LIKE 'group:%'
  `;
  for (const row of dmRows as any[]) {
    const key: string = row.chat_key;
    if (!key.includes(user.id)) continue;
    const msgs = await getChatMessages(key, 1);
    if (!msgs.length) continue;
    const otherId = otherUserId(key, user.id);
    const otherProfile = profiles[otherId] ?? null;
    result.push({
      type: "dm", key, otherUserId: otherId,
      otherProfile: otherProfile ? { ...otherProfile, avatarBase64: !!otherProfile.avatarBase64 } : null,
      lastMessage: msgs[msgs.length - 1],
    });
  }

  // Group chats
  for (const [groupId, group] of Object.entries(groups)) {
    if (!group.members.includes(user.id)) continue;
    const key = groupKey(groupId);
    const msgs = await getChatMessages(key, 1);
    if (!msgs.length) continue;
    result.push({
      type: "group", key, groupId,
      group: { id: groupId, name: group.name, avatarBase64: !!group.avatarBase64, adminId: group.adminId, memberCount: group.members.length },
      lastMessage: msgs[msgs.length - 1],
    });
  }

  result.sort((a: any, b: any) =>
    new Date(b.lastMessage.timestamp).getTime() - new Date(a.lastMessage.timestamp).getTime()
  );
  res.json(result);
});

// ── DM: messages ─────────────────────────────────────────────────────────────
router.get("/messages/chat/:phone", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const otherProf = await getProfileByPhone(req.params.phone);
  if (!otherProf) { res.status(404).json({ error: "user_not_found" }); return; }
  const key = chatKey(user.id, otherProf.userId);
  const messages = await getChatMessages(key);
  res.json({ messages, otherProfile: { ...otherProf, avatarBase64: !!otherProf.avatarBase64 } });
});

// ── DM: send ─────────────────────────────────────────────────────────────────
router.post("/messages/send", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { toPhone, content, type } = req.body as { toPhone?: string; content?: string; type?: string };
  if (!toPhone || !content) { res.status(400).json({ error: "toPhone and content are required" }); return; }
  const myProfile = await getProfileByUserId(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup your profile first" }); return; }
  const toProfile = await getProfileByPhone(toPhone);
  if (!toProfile) { res.status(404).json({ error: "recipient not found" }); return; }
  const key = chatKey(user.id, toProfile.userId);
  const message: MsgMessage = {
    id: genId(), from: user.id, to: toProfile.userId,
    content, type: (type === "image" ? "image" : "text"),
    timestamp: new Date().toISOString(),
  };
  await insertMessage(key, message);
  res.json(message);
});

// ── Groups: create ────────────────────────────────────────────────────────────
router.post("/messages/groups", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { name, memberPhones, avatarBase64 } = req.body as { name?: string; memberPhones?: string[]; avatarBase64?: string };
  if (!name || !name.trim()) { res.status(400).json({ error: "name is required" }); return; }
  const myProfile = await getProfileByUserId(user.id);
  if (!myProfile?.name) { res.status(403).json({ error: "setup profile first" }); return; }
  const members = [user.id];
  if (memberPhones?.length) {
    for (const phone of memberPhones) {
      const p = await getProfileByPhone(phone);
      if (p?.name && !members.includes(p.userId)) members.push(p.userId);
    }
  }
  const groupId = genId();
  const group: MsgGroup = {
    id: groupId, name: name.trim(), avatarBase64: avatarBase64 ?? null,
    adminId: user.id, members, createdAt: new Date().toISOString(),
  };
  await upsertGroup(group);
  res.json({ ...group, avatarBase64: !!group.avatarBase64 });
});

// ── Groups: get info ──────────────────────────────────────────────────────────
router.get("/messages/groups/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (!group.members.includes(user.id)) { res.status(403).json({ error: "not a member" }); return; }
  const profiles = await getAllProfiles();
  const members = group.members.map(uid => {
    const p = profiles[uid];
    return p ? { userId: uid, phone: p.phone, name: p.name, familyName: p.familyName, avatarBase64: !!p.avatarBase64 } : { userId: uid };
  });
  res.json({ ...group, avatarBase64: !!group.avatarBase64, members });
});

// ── Groups: update settings ───────────────────────────────────────────────────
router.put("/messages/groups/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (group.adminId !== user.id) { res.status(403).json({ error: "admin only" }); return; }
  const { name, avatarBase64 } = req.body as { name?: string; avatarBase64?: string };
  if (name && name.trim()) group.name = name.trim();
  if (avatarBase64 !== undefined) group.avatarBase64 = avatarBase64 || null;
  await upsertGroup(group);
  res.json({ ...group, avatarBase64: !!group.avatarBase64 });
});

// ── Groups: add member ────────────────────────────────────────────────────────
router.post("/messages/groups/:id/members", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (group.adminId !== user.id) { res.status(403).json({ error: "admin only" }); return; }
  const { phone } = req.body as { phone?: string };
  if (!phone) { res.status(400).json({ error: "phone is required" }); return; }
  const target = await getProfileByPhone(phone);
  if (!target?.name) { res.status(404).json({ error: "user not found" }); return; }
  if (group.members.includes(target.userId)) { res.status(409).json({ error: "already a member" }); return; }
  group.members.push(target.userId);
  await upsertGroup(group);
  res.json({ ok: true, userId: target.userId, name: target.name, phone: target.phone });
});

// ── Groups: remove member ─────────────────────────────────────────────────────
router.delete("/messages/groups/:id/members/:phone", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (group.adminId !== user.id) { res.status(403).json({ error: "admin only" }); return; }
  const target = await getProfileByPhone(req.params.phone);
  if (!target) { res.status(404).json({ error: "user not found" }); return; }
  if (target.userId === user.id) { res.status(400).json({ error: "cannot remove yourself" }); return; }
  group.members = group.members.filter(m => m !== target.userId);
  await upsertGroup(group);
  res.json({ ok: true });
});

// ── Groups: messages ──────────────────────────────────────────────────────────
router.get("/messages/groups/:id/messages", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (!group.members.includes(user.id)) { res.status(403).json({ error: "not a member" }); return; }
  const messages = await getChatMessages(groupKey(req.params.id));
  res.json({ messages, group: { ...group, avatarBase64: !!group.avatarBase64 } });
});

// ── Groups: send ──────────────────────────────────────────────────────────────
router.post("/messages/groups/:id/send", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const group = await getGroup(req.params.id);
  if (!group) { res.status(404).json({ error: "group not found" }); return; }
  if (!group.members.includes(user.id)) { res.status(403).json({ error: "not a member" }); return; }
  const { content, type } = req.body as { content?: string; type?: string };
  if (!content) { res.status(400).json({ error: "content is required" }); return; }
  const myProfile = await getProfileByUserId(user.id);
  const senderName = myProfile ? (myProfile.name + (myProfile.familyName ? " " + myProfile.familyName : "")) : "مجهول";
  const message: MsgMessage = {
    id: genId(), from: user.id, to: req.params.id,
    content, type: (type === "image" ? "image" : "text"),
    timestamp: new Date().toISOString(), senderName,
  };
  await insertMessage(groupKey(req.params.id), message);
  res.json(message);
});

// ── Poll ──────────────────────────────────────────────────────────────────────
router.get("/messages/poll", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const since = req.query.since as string | undefined;
  const sinceTs = since ? new Date(since).getTime() : 0;
  const profiles = await getAllProfiles();
  const groups = await getAllGroups();
  const newMessages: object[] = [];
  const sql = getSql();

  // DM messages to me
  const dmKeys = await sql`SELECT DISTINCT chat_key FROM msg_chats WHERE to_id = ${user.id} AND chat_key NOT LIKE 'group:%'`;
  for (const row of dmKeys as any[]) {
    const msgs = await getChatMessages(row.chat_key);
    for (const msg of msgs) {
      if (msg.to !== user.id) continue;
      if (sinceTs && new Date(msg.timestamp).getTime() <= sinceTs) continue;
      const otherProf = profiles[msg.from];
      newMessages.push({ ...msg, chatType: "dm", chatPhone: otherProf?.phone ?? "" });
    }
  }

  // Group messages (from others)
  for (const [groupId, group] of Object.entries(groups)) {
    if (!group.members.includes(user.id)) continue;
    const msgs = await getChatMessages(groupKey(groupId));
    for (const msg of msgs) {
      if (msg.from === user.id) continue;
      if (sinceTs && new Date(msg.timestamp).getTime() <= sinceTs) continue;
      newMessages.push({ ...msg, chatType: "group", groupId, groupName: group.name });
    }
  }

  res.json({ messages: newMessages, ts: new Date().toISOString() });
});

export default router;
