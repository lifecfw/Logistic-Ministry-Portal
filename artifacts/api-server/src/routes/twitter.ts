import { Router, type IRouter, type Request, type Response } from "express";
import { getSession, createSession, SESSION_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_MS } from "../lib/sessions";
import { getSql } from "../lib/db";
import express from "express";

const router: IRouter = Router();
router.use(express.json({ limit: "8mb" }));

const ADMIN_DISCORD_USERNAME = "n16q";

interface TwProfile {
  userId: string;
  discordUsername: string;
  username: string;
  displayName: string;
  bio: string;
  avatarBase64: string | null;
  headerBase64: string | null;
  verified: boolean;
  password?: string;
  fakeFollowerCount?: number;
  followers: string[];
  following: string[];
  createdAt: string;
}

interface Tweet {
  id: string;
  authorId: string;
  content: string;
  imageBase64: string | null;
  likes: string[];
  retweetedBy: string[];
  replyTo: string | null;
  retweetOf: string | null;
  timestamp: string;
}

interface Notification {
  id: string;
  type: "like" | "retweet" | "reply" | "follow" | "tweet";
  fromUserId: string;
  toUserId: string;
  tweetId?: string;
  timestamp: string;
  read: boolean;
}

function rowToProfile(p: any): TwProfile {
  return {
    userId: p.user_id,
    discordUsername: p.discord_username,
    username: p.username,
    displayName: p.display_name,
    bio: p.bio || "",
    avatarBase64: p.avatar_base64 ?? null,
    headerBase64: p.header_base64 ?? null,
    verified: !!p.verified,
    password: p.password ?? undefined,
    fakeFollowerCount: p.fake_follower_count ?? 0,
    followers: (p.followers as string[]) || [],
    following: (p.following as string[]) || [],
    createdAt: p.created_at instanceof Date ? p.created_at.toISOString() : String(p.created_at),
  };
}

function rowToTweet(t: any): Tweet {
  return {
    id: t.id,
    authorId: t.author_id,
    content: t.content || "",
    imageBase64: t.image_base64 ?? null,
    likes: (t.likes as string[]) || [],
    retweetedBy: (t.retweeted_by as string[]) || [],
    replyTo: t.reply_to ?? null,
    retweetOf: t.retweet_of ?? null,
    timestamp: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
  };
}

function rowToNotif(n: any): Notification {
  return {
    id: n.id,
    type: n.type,
    fromUserId: n.from_user_id,
    toUserId: n.to_user_id,
    tweetId: n.tweet_id ?? undefined,
    timestamp: n.created_at instanceof Date ? n.created_at.toISOString() : String(n.created_at),
    read: !!n.read,
  };
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

function safeProfile(p: TwProfile, myId?: string) {
  const { avatarBase64, headerBase64, password, discordUsername, ...rest } = p;
  return {
    ...rest,
    hasAvatar: !!avatarBase64,
    hasHeader: !!headerBase64,
    hasPassword: !!password,
    isFollowing: myId ? p.followers.includes(myId) : false,
    isFollowingMe: myId ? p.following.includes(myId) : false,
    followerCount: p.followers.length + (p.fakeFollowerCount || 0),
    followingCount: p.following.length,
  };
}

async function upsertProfile(p: TwProfile): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO tw_profiles (user_id, discord_username, username, display_name, bio, avatar_base64, header_base64, verified, password, fake_follower_count, followers, following, created_at)
    VALUES (${p.userId}, ${p.discordUsername}, ${p.username}, ${p.displayName}, ${p.bio}, ${p.avatarBase64}, ${p.headerBase64}, ${p.verified}, ${p.password ?? null}, ${p.fakeFollowerCount ?? 0}, ${JSON.stringify(p.followers) as any}, ${JSON.stringify(p.following) as any}, ${p.createdAt})
    ON CONFLICT (user_id) DO UPDATE SET
      discord_username = EXCLUDED.discord_username,
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      bio = EXCLUDED.bio,
      avatar_base64 = EXCLUDED.avatar_base64,
      header_base64 = EXCLUDED.header_base64,
      verified = EXCLUDED.verified,
      password = EXCLUDED.password,
      fake_follower_count = EXCLUDED.fake_follower_count,
      followers = EXCLUDED.followers,
      following = EXCLUDED.following
  `;
}

async function upsertTweet(t: Tweet): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO tw_tweets (id, author_id, content, image_base64, likes, retweeted_by, reply_to, retweet_of, created_at)
    VALUES (${t.id}, ${t.authorId}, ${t.content}, ${t.imageBase64}, ${JSON.stringify(t.likes) as any}, ${JSON.stringify(t.retweetedBy) as any}, ${t.replyTo}, ${t.retweetOf}, ${t.timestamp})
    ON CONFLICT (id) DO UPDATE SET
      likes = EXCLUDED.likes,
      retweeted_by = EXCLUDED.retweeted_by
  `;
}

async function deleteTweet(id: string): Promise<void> {
  const sql = getSql();
  await sql`DELETE FROM tw_tweets WHERE id = ${id}`;
}

async function insertNotif(n: Notification): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO tw_notifications (id, type, from_user_id, to_user_id, tweet_id, created_at, read)
    VALUES (${n.id}, ${n.type}, ${n.fromUserId}, ${n.toUserId}, ${n.tweetId ?? null}, ${n.timestamp}, ${n.read})
    ON CONFLICT (id) DO NOTHING
  `;
  // Prune old notifications for this user (keep 500)
  await sql`
    DELETE FROM tw_notifications WHERE id IN (
      SELECT id FROM tw_notifications WHERE to_user_id = ${n.toUserId}
      ORDER BY created_at ASC OFFSET 500
    )
  `;
}

async function pushNotif(toUserId: string, notif: Omit<Notification, "id" | "timestamp" | "read">): Promise<void> {
  if (notif.fromUserId === toUserId) return;
  const n: Notification = { ...notif, id: genId(), timestamp: new Date().toISOString(), read: false };
  await insertNotif(n);
}

async function getAllProfiles(): Promise<Record<string, TwProfile>> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_profiles`;
  const out: Record<string, TwProfile> = {};
  for (const row of rows as any[]) {
    const p = rowToProfile(row);
    out[p.userId] = p;
  }
  return out;
}

async function getProfileById(userId: string): Promise<TwProfile | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_profiles WHERE user_id = ${userId}`;
  if (!rows.length) return null;
  return rowToProfile(rows[0]);
}

async function getProfileByUsername(username: string): Promise<TwProfile | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_profiles WHERE username = ${username.toLowerCase()}`;
  if (!rows.length) return null;
  return rowToProfile(rows[0]);
}

async function getRecentTweets(limit = 1000): Promise<Record<string, Tweet>> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_tweets ORDER BY created_at DESC LIMIT ${limit}`;
  const out: Record<string, Tweet> = {};
  for (const row of rows as any[]) {
    const t = rowToTweet(row);
    out[t.id] = t;
  }
  return out;
}

async function getTweetById(id: string): Promise<Tweet | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_tweets WHERE id = ${id}`;
  if (!rows.length) return null;
  return rowToTweet(rows[0]);
}

async function enrichTweet(tweet: Tweet, profiles: Record<string, TwProfile>, tweets: Record<string, Tweet>, myId: string) {
  const author = profiles[tweet.authorId];
  let original: any = null;
  let originalAuthor: any = null;
  if (tweet.retweetOf) {
    const orig = tweets[tweet.retweetOf];
    if (orig) {
      const origAuth = profiles[orig.authorId];
      const replyCount = Object.values(tweets).filter(t => t.replyTo === orig.id).length;
      original = { ...orig, hasImage: !!orig.imageBase64, imageBase64: undefined, likeCount: orig.likes.length, retweetCount: orig.retweetedBy.length, replyCount };
      if (origAuth) originalAuthor = safeProfile(origAuth, myId);
    }
  }
  const replyCount = Object.values(tweets).filter(t => t.replyTo === tweet.id).length;
  return {
    ...tweet,
    hasImage: !!tweet.imageBase64,
    imageBase64: undefined,
    likeCount: tweet.likes.length,
    retweetCount: tweet.retweetedBy.length,
    replyCount,
    myLike: tweet.likes.includes(myId),
    myRetweet: tweet.retweetedBy.includes(myId),
    author: author ? safeProfile(author, myId) : null,
    original,
    originalAuthor,
  };
}

// ── My profile ──────────────────────────────────────────────────────────────
router.get("/twitter/me", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileById(user.id);
  if (!profile) { res.status(404).json({ error: "no_profile" }); return; }
  res.json({ ...safeProfile(profile, user.id), isAdmin: user.username === ADMIN_DISCORD_USERNAME });
});

// ── Setup / update profile ──────────────────────────────────────────────────
router.post("/twitter/setup", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { username, displayName, bio, avatarBase64, headerBase64 } = req.body as {
    username?: string; displayName?: string; bio?: string; avatarBase64?: string; headerBase64?: string;
  };
  if (!username || !username.trim()) { res.status(400).json({ error: "username required" }); return; }
  const uname = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (!uname || uname.length > 20) { res.status(400).json({ error: "username must be 1-20 chars (letters, numbers, _)" }); return; }
  if (!displayName || !displayName.trim()) { res.status(400).json({ error: "displayName required" }); return; }

  const existing = await getProfileById(user.id);
  const taken = await getProfileByUsername(uname);
  if (taken && taken.userId !== user.id) { res.status(409).json({ error: "username_taken" }); return; }

  const updated: TwProfile = {
    userId: user.id,
    discordUsername: user.username,
    username: uname,
    displayName: displayName.trim(),
    bio: (bio || "").trim(),
    avatarBase64: avatarBase64 ?? existing?.avatarBase64 ?? null,
    headerBase64: headerBase64 ?? existing?.headerBase64 ?? null,
    verified: existing?.verified ?? false,
    password: existing?.password,
    fakeFollowerCount: existing?.fakeFollowerCount ?? 0,
    followers: existing?.followers ?? [],
    following: existing?.following ?? [],
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  await upsertProfile(updated);
  res.json({ ...safeProfile(updated, user.id), isAdmin: user.username === ADMIN_DISCORD_USERNAME });
});

// ── Check username availability ──────────────────────────────────────────────
router.get("/twitter/check-username/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const uname = req.params.username.toLowerCase().replace(/[^a-z0-9_]/g, "");
  const taken = await getProfileByUsername(uname);
  res.json({ available: !taken || taken.userId === user.id, username: uname });
});

// ── Get profile by username ──────────────────────────────────────────────────
router.get("/twitter/profile/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!profile) { res.status(404).json({ error: "not_found" }); return; }
  res.json(safeProfile(profile, user.id));
});

// ── Get avatar/header ────────────────────────────────────────────────────────
router.get("/twitter/avatar/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!profile?.avatarBase64) { res.status(404).json({ error: "no_avatar" }); return; }
  res.json({ avatarBase64: profile.avatarBase64 });
});

router.get("/twitter/header/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const profile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!profile?.headerBase64) { res.status(404).json({ error: "no_header" }); return; }
  res.json({ headerBase64: profile.headerBase64 });
});

// ── Profile tweets ───────────────────────────────────────────────────────────
router.get("/twitter/profile/:username/tweets", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const target = await getProfileByUsername(req.params.username.toLowerCase());
  if (!target) { res.status(404).json({ error: "not_found" }); return; }

  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_tweets WHERE author_id = ${target.userId} AND reply_to IS NULL ORDER BY created_at DESC LIMIT 50`;
  const tweetList = (rows as any[]).map(rowToTweet);
  const allTweets = await getRecentTweets(500);
  const profiles = await getAllProfiles();
  const tweets = tweetList.map(t => enrichTweet(t, profiles, allTweets, user.id));
  res.json(await Promise.all(tweets));
});

// ── Feed (home timeline) ─────────────────────────────────────────────────────
router.get("/twitter/feed", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const myProfile = await getProfileById(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup profile first" }); return; }

  const relevantIds = [user.id, ...myProfile.following];
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_tweets WHERE author_id = ANY(${relevantIds}) AND reply_to IS NULL ORDER BY created_at DESC LIMIT 60`;
  const tweetList = (rows as any[]).map(rowToTweet);
  const allTweets = await getRecentTweets(500);
  const profiles = await getAllProfiles();
  const tweets = await Promise.all(tweetList.map(t => enrichTweet(t, profiles, allTweets, user.id)));
  res.json(tweets);
});

// ── Explore (all latest tweets, no profile required) ─────────────────────────
router.get("/twitter/explore", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const limit = Math.min(Number(req.query.limit) || 60, 100);
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_tweets WHERE reply_to IS NULL AND retweet_of IS NULL ORDER BY created_at DESC LIMIT ${limit}`;
  const tweetList = (rows as any[]).map(rowToTweet);
  const allTweets = await getRecentTweets(500);
  const profiles = await getAllProfiles();
  const tweets = await Promise.all(tweetList.map(t => enrichTweet(t, profiles, allTweets, user.id)));
  res.json(tweets);
});

// ── Post tweet ───────────────────────────────────────────────────────────────
router.post("/twitter/tweet", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { content, imageBase64, replyTo } = req.body as { content?: string; imageBase64?: string; replyTo?: string };
  if (!content && !imageBase64) { res.status(400).json({ error: "content or image required" }); return; }
  const myProfile = await getProfileById(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup profile first" }); return; }

  if (replyTo) {
    const parent = await getTweetById(replyTo);
    if (!parent) { res.status(404).json({ error: "tweet not found" }); return; }
    const tweet: Tweet = {
      id: genId(), authorId: user.id,
      content: (content || "").trim(), imageBase64: imageBase64 ?? null,
      likes: [], retweetedBy: [], replyTo, retweetOf: null,
      timestamp: new Date().toISOString(),
    };
    await upsertTweet(tweet);
    if (parent.authorId !== user.id) {
      await pushNotif(parent.authorId, { type: "reply", fromUserId: user.id, toUserId: parent.authorId, tweetId: tweet.id });
    }
    const profiles = await getAllProfiles();
    const allTweets = await getRecentTweets(200);
    res.json(await enrichTweet(tweet, profiles, allTweets, user.id));
    return;
  }

  const tweet: Tweet = {
    id: genId(), authorId: user.id,
    content: (content || "").trim(), imageBase64: imageBase64 ?? null,
    likes: [], retweetedBy: [], replyTo: null, retweetOf: null,
    timestamp: new Date().toISOString(),
  };
  await upsertTweet(tweet);
  // Notify all real followers
  await Promise.all(myProfile.followers.map(followerId =>
    pushNotif(followerId, { type: "tweet", fromUserId: user.id, toUserId: followerId, tweetId: tweet.id })
  ));
  const profiles = await getAllProfiles();
  const allTweets = await getRecentTweets(200);
  res.json(await enrichTweet(tweet, profiles, allTweets, user.id));
});

// ── Retweet ──────────────────────────────────────────────────────────────────
router.post("/twitter/tweet/:id/retweet", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const original = await getTweetById(req.params.id);
  if (!original) { res.status(404).json({ error: "tweet not found" }); return; }
  const myProfile = await getProfileById(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup profile first" }); return; }

  if (original.retweetedBy.includes(user.id)) {
    original.retweetedBy = original.retweetedBy.filter(id => id !== user.id);
    await upsertTweet(original);
    // Remove the retweet tweet
    const sql = getSql();
    await sql`DELETE FROM tw_tweets WHERE retweet_of = ${req.params.id} AND author_id = ${user.id}`;
    res.json({ retweeted: false, count: original.retweetedBy.length }); return;
  }

  original.retweetedBy.push(user.id);
  await upsertTweet(original);
  const retweet: Tweet = {
    id: genId(), authorId: user.id, content: "", imageBase64: null,
    likes: [], retweetedBy: [], replyTo: null, retweetOf: req.params.id,
    timestamp: new Date().toISOString(),
  };
  await upsertTweet(retweet);
  await pushNotif(original.authorId, { type: "retweet", fromUserId: user.id, toUserId: original.authorId, tweetId: req.params.id });
  res.json({ retweeted: true, count: original.retweetedBy.length });
});

// ── Like ─────────────────────────────────────────────────────────────────────
router.post("/twitter/tweet/:id/like", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const tweet = await getTweetById(req.params.id);
  if (!tweet) { res.status(404).json({ error: "tweet not found" }); return; }
  const myProfile = await getProfileById(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup profile first" }); return; }

  if (tweet.likes.includes(user.id)) {
    tweet.likes = tweet.likes.filter(id => id !== user.id);
    await upsertTweet(tweet);
    res.json({ liked: false, count: tweet.likes.length });
  } else {
    tweet.likes.push(user.id);
    await upsertTweet(tweet);
    await pushNotif(tweet.authorId, { type: "like", fromUserId: user.id, toUserId: tweet.authorId, tweetId: tweet.id });
    res.json({ liked: true, count: tweet.likes.length });
  }
});

// ── Get tweet + replies ──────────────────────────────────────────────────────
router.get("/twitter/tweet/:id", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const tweet = await getTweetById(req.params.id);
  if (!tweet) { res.status(404).json({ error: "not found" }); return; }

  const sql = getSql();
  const replyRows = await sql`SELECT * FROM tw_tweets WHERE reply_to = ${req.params.id} ORDER BY created_at ASC`;
  const replyList = (replyRows as any[]).map(rowToTweet);
  const profiles = await getAllProfiles();
  const allTweets = await getRecentTweets(200);
  const replies = await Promise.all(replyList.map(t => enrichTweet(t, profiles, allTweets, user.id)));
  res.json({ tweet: await enrichTweet(tweet, profiles, allTweets, user.id), replies });
});

// ── Get tweet image ──────────────────────────────────────────────────────────
router.get("/twitter/tweet/:id/image", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const tweet = await getTweetById(req.params.id);
  if (!tweet?.imageBase64) { res.status(404).json({ error: "no image" }); return; }
  res.json({ imageBase64: tweet.imageBase64 });
});

// ── Follow / Unfollow ────────────────────────────────────────────────────────
router.post("/twitter/follow/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const myProfile = await getProfileById(user.id);
  if (!myProfile) { res.status(403).json({ error: "setup profile first" }); return; }

  const targetProfile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!targetProfile || targetProfile.userId === user.id) { res.status(400).json({ error: "invalid" }); return; }

  if (myProfile.following.includes(targetProfile.userId)) {
    myProfile.following = myProfile.following.filter(id => id !== targetProfile.userId);
    targetProfile.followers = targetProfile.followers.filter(id => id !== user.id);
    await Promise.all([upsertProfile(myProfile), upsertProfile(targetProfile)]);
    res.json({ following: false, followerCount: targetProfile.followers.length + (targetProfile.fakeFollowerCount || 0) });
  } else {
    myProfile.following.push(targetProfile.userId);
    targetProfile.followers.push(user.id);
    await Promise.all([upsertProfile(myProfile), upsertProfile(targetProfile)]);
    await pushNotif(targetProfile.userId, { type: "follow", fromUserId: user.id, toUserId: targetProfile.userId });
    res.json({ following: true, followerCount: targetProfile.followers.length + (targetProfile.fakeFollowerCount || 0) });
  }
});

// ── Search users ─────────────────────────────────────────────────────────────
router.get("/twitter/search", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const q = ((req.query.q as string) || "").trim().toLowerCase();
  if (!q) { res.json([]); return; }
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_profiles WHERE username ILIKE ${"%" + q + "%"} OR display_name ILIKE ${"%" + q + "%"} LIMIT 20`;
  res.json((rows as any[]).map(r => safeProfile(rowToProfile(r), user.id)));
});

// ── Who to follow (suggestions) ──────────────────────────────────────────────
router.get("/twitter/suggestions", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const myProfile = await getProfileById(user.id);
  const profiles = await getAllProfiles();
  const suggestions = Object.values(profiles)
    .filter(p => p.userId !== user.id && !(myProfile?.following.includes(p.userId)))
    .sort((a, b) => b.followers.length - a.followers.length)
    .slice(0, 5)
    .map(p => safeProfile(p, user.id));
  res.json(suggestions);
});

// ── Notifications ─────────────────────────────────────────────────────────────
router.get("/twitter/notifications", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const rows = await sql`SELECT * FROM tw_notifications WHERE to_user_id = ${user.id} ORDER BY created_at DESC LIMIT 60`;
  const mine = (rows as any[]).map(rowToNotif);
  const unreadCount = mine.filter(n => !n.read).length;
  const profiles = await getAllProfiles();
  const enriched = await Promise.all(mine.map(async n => {
    const from = profiles[n.fromUserId];
    let tweetContent: string | null = null;
    if (n.tweetId) {
      const tweet = await getTweetById(n.tweetId);
      tweetContent = tweet ? (tweet.content || "").slice(0, 120) : null;
    }
    return {
      ...n,
      fromProfile: from ? { username: from.username, displayName: from.displayName, hasAvatar: !!from.avatarBase64, verified: from.verified } : null,
      tweetContent,
    };
  }));
  res.json({ notifications: enriched, unreadCount });
});

router.post("/twitter/notifications/read", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  await sql`UPDATE tw_notifications SET read = TRUE WHERE to_user_id = ${user.id} AND read = FALSE`;
  res.json({ ok: true });
});

router.get("/twitter/notifications/unread-count", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const sql = getSql();
  const rows = await sql`SELECT COUNT(*) as count FROM tw_notifications WHERE to_user_id = ${user.id} AND read = FALSE`;
  res.json({ count: Number((rows[0] as any).count) });
});

// ── Set / update account password ────────────────────────────────────────────
router.post("/twitter/set-password", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  const { password } = req.body as { password?: string };
  if (!password || password.trim().length < 6) { res.status(400).json({ error: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" }); return; }
  const profile = await getProfileById(user.id);
  if (!profile) { res.status(404).json({ error: "no_profile" }); return; }
  profile.password = password.trim();
  await upsertProfile(profile);
  res.json({ ok: true });
});

// ── Login with Twitter @username + password ───────────────────────────────────
router.post("/twitter/login-password", async (req, res) => {
  const { twitterUsername, password } = req.body as { twitterUsername?: string; password?: string };
  if (!twitterUsername || !password) { res.status(400).json({ error: "missing fields" }); return; }
  const uname = twitterUsername.replace(/^@/, "").trim().toLowerCase();
  const profile = await getProfileByUsername(uname);
  if (!profile) { res.status(404).json({ error: "الحساب غير موجود" }); return; }
  if (!profile.password) { res.status(403).json({ error: "هذا الحساب ليس له كلمة مرور" }); return; }
  if (profile.password !== password.trim()) { res.status(401).json({ error: "كلمة المرور غير صحيحة" }); return; }
  const token = createSession({
    id: profile.userId,
    username: profile.discordUsername || profile.username,
    displayName: profile.displayName,
    avatarUrl: "",
  });
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true, sameSite: "lax",
    maxAge: SESSION_COOKIE_MAX_AGE_MS,
    secure: process.env.NODE_ENV === "production",
  });
  res.json({ ok: true, username: profile.username, displayName: profile.displayName });
});

// ── Admin: list users ────────────────────────────────────────────────────────
router.get("/twitter/admin/users", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN_DISCORD_USERNAME) { res.status(403).json({ error: "admin only" }); return; }
  const profiles = await getAllProfiles();
  res.json(Object.values(profiles).map(p => safeProfile(p, user.id)));
});

// ── Admin: toggle verify ─────────────────────────────────────────────────────
router.post("/twitter/admin/verify/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN_DISCORD_USERNAME) { res.status(403).json({ error: "admin only" }); return; }
  const profile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!profile) { res.status(404).json({ error: "not found" }); return; }
  profile.verified = !profile.verified;
  await upsertProfile(profile);
  res.json({ verified: profile.verified, username: profile.username });
});

// ── Admin: set fake follower count ───────────────────────────────────────────
router.post("/twitter/admin/fake-followers/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN_DISCORD_USERNAME) { res.status(403).json({ error: "admin only" }); return; }
  const { count } = req.body as { count?: number };
  if (typeof count !== "number" || count < 0) { res.status(400).json({ error: "count must be a non-negative number" }); return; }
  const profile = await getProfileByUsername(req.params.username.toLowerCase());
  if (!profile) { res.status(404).json({ error: "not found" }); return; }
  profile.fakeFollowerCount = Math.floor(count);
  await upsertProfile(profile);
  res.json({ ok: true, followerCount: profile.followers.length + (profile.fakeFollowerCount || 0) });
});

// ── Admin: add follower ───────────────────────────────────────────────────────
router.post("/twitter/admin/add-follower/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN_DISCORD_USERNAME) { res.status(403).json({ error: "admin only" }); return; }
  const { followerUsername } = req.body as { followerUsername?: string };
  if (!followerUsername) { res.status(400).json({ error: "followerUsername required" }); return; }
  const target = await getProfileByUsername(req.params.username.toLowerCase());
  const follower = await getProfileByUsername(followerUsername.toLowerCase().replace(/^@/, ""));
  if (!target) { res.status(404).json({ error: "الحساب المستهدف غير موجود" }); return; }
  if (!follower) { res.status(404).json({ error: "حساب المتابع غير موجود" }); return; }
  if (target.userId === follower.userId) { res.status(400).json({ error: "لا يمكن متابعة نفس الحساب" }); return; }
  if (!target.followers.includes(follower.userId)) {
    target.followers.push(follower.userId);
    if (!follower.following.includes(target.userId)) follower.following.push(target.userId);
    await Promise.all([upsertProfile(target), upsertProfile(follower)]);
  }
  res.json({ ok: true, followerCount: target.followers.length });
});

// ── Admin: remove follower ────────────────────────────────────────────────────
router.post("/twitter/admin/remove-follower/:username", async (req, res) => {
  const user = requireUser(req, res); if (!user) return;
  if (user.username !== ADMIN_DISCORD_USERNAME) { res.status(403).json({ error: "admin only" }); return; }
  const { followerUsername } = req.body as { followerUsername?: string };
  if (!followerUsername) { res.status(400).json({ error: "followerUsername required" }); return; }
  const target = await getProfileByUsername(req.params.username.toLowerCase());
  const follower = await getProfileByUsername(followerUsername.toLowerCase().replace(/^@/, ""));
  if (!target) { res.status(404).json({ error: "الحساب المستهدف غير موجود" }); return; }
  if (!follower) { res.status(404).json({ error: "حساب المتابع غير موجود" }); return; }
  target.followers = target.followers.filter(id => id !== follower.userId);
  follower.following = follower.following.filter(id => id !== target.userId);
  await Promise.all([upsertProfile(target), upsertProfile(follower)]);
  res.json({ ok: true, followerCount: target.followers.length });
});

export default router;
