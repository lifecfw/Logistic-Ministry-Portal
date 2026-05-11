import { logger } from "./logger";

const DISCORD_API = "https://discord.com/api/v10";

function getBotToken(): string {
  const token = process.env["DISCORD_BOT_TOKEN"];
  if (!token) {
    throw new Error("DISCORD_BOT_TOKEN is not configured");
  }
  return token;
}

function getGuildId(): string {
  const guildId = process.env["DISCORD_GUILD_ID"];
  if (!guildId) {
    throw new Error("DISCORD_GUILD_ID is not configured");
  }
  return guildId;
}

function authHeader(): Record<string, string> {
  return {
    Authorization: `Bot ${getBotToken()}`,
    "Content-Type": "application/json",
  };
}

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  discriminator: string;
  avatar: string | null;
}

interface DiscordGuildMember {
  user?: DiscordUser;
  nick?: string | null;
}

export interface ResolvedDiscordUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string;
}

function buildAvatarUrl(user: DiscordUser): string {
  if (user.avatar) {
    const ext = user.avatar.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
  }
  // Default avatar — for new users discriminator is "0"
  let index: number;
  if (user.discriminator && user.discriminator !== "0") {
    index = Number(user.discriminator) % 5;
  } else {
    try {
      index = Number((BigInt(user.id) >> 22n) % 6n);
    } catch {
      index = 0;
    }
  }
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function toResolved(user: DiscordUser, nick?: string | null): ResolvedDiscordUser {
  return {
    id: user.id,
    username: user.username,
    displayName: nick || user.global_name || user.username,
    avatarUrl: buildAvatarUrl(user),
  };
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, "");
}

export async function findGuildMemberByUsername(
  rawQuery: string,
): Promise<ResolvedDiscordUser | null> {
  const guildId = getGuildId();
  const query = normalize(rawQuery);
  if (!query) return null;

  const url = `${DISCORD_API}/guilds/${guildId}/members/search?query=${encodeURIComponent(
    query,
  )}&limit=10`;

  const response = await fetch(url, { headers: authHeader() });

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, body },
      "Discord member search failed",
    );
    throw new Error(`Discord member search failed: ${response.status}`);
  }

  const members = (await response.json()) as DiscordGuildMember[];

  // Try exact match first on username, global_name, then nickname
  const match = members.find((m) => {
    const u = m.user;
    if (!u) return false;
    return (
      normalize(u.username) === query ||
      (u.global_name ? normalize(u.global_name) === query : false) ||
      (m.nick ? normalize(m.nick) === query : false)
    );
  });

  const chosen = match ?? members[0];
  if (!chosen?.user) return null;

  return toResolved(chosen.user, chosen.nick);
}

export async function getUserById(userId: string): Promise<ResolvedDiscordUser | null> {
  const guildId = getGuildId();
  const url = `${DISCORD_API}/guilds/${guildId}/members/${userId}`;
  const response = await fetch(url, { headers: authHeader() });
  if (response.status === 404) return null;
  if (!response.ok) {
    logger.error({ status: response.status }, "Discord get member failed");
    return null;
  }
  const member = (await response.json()) as DiscordGuildMember;
  if (!member.user) return null;
  return toResolved(member.user, member.nick);
}

export async function assignRole(userId: string, roleId: string): Promise<boolean> {
  try {
    const guildId = getGuildId();
    const url = `${DISCORD_API}/guilds/${guildId}/members/${userId}/roles/${roleId}`;
    const response = await fetch(url, { method: "PUT", headers: authHeader() });
    return response.status === 204;
  } catch {
    return false;
  }
}

export class DiscordDmError extends Error {
  readonly code: "dm_blocked" | "unknown";
  constructor(code: "dm_blocked" | "unknown", message: string) {
    super(message);
    this.code = code;
    this.name = "DiscordDmError";
  }
}

async function createDmChannel(userId: string): Promise<string> {
  const response = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, body },
      "Failed to create DM channel",
    );
    throw new DiscordDmError("unknown", "Failed to create DM channel");
  }
  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function sendVerificationDm(
  userId: string,
  code: string,
): Promise<void> {
  const channelId = await createDmChannel(userId);

  const content = [
    "**وزارة اللوجستيك — Arab First City**",
    "",
    `رمز التحقق الخاص بك: **${code}**`,
    "",
    "هذا الرمز صالح لمدة 10 دقائق فقط.",
    "إذا لم تطلب هذا الرمز، تجاهل هذه الرسالة.",
  ].join("\n");

  const response = await fetch(
    `${DISCORD_API}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: authHeader(),
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    logger.error(
      { status: response.status, body },
      "Failed to send DM",
    );
    if (response.status === 403) {
      throw new DiscordDmError(
        "dm_blocked",
        "User has DMs disabled or blocked the bot",
      );
    }
    throw new DiscordDmError("unknown", "Failed to send verification DM");
  }
}
