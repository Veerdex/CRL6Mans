const GUILD_ID = process.env.DISCORD_GUILD_ID ?? "";
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN ?? "";
const API = "https://discord.com/api/v10";

const botHeaders = (json?: boolean): Record<string, string> => ({
  Authorization: `Bot ${BOT_TOKEN}`,
  ...(json ? { "Content-Type": "application/json" } : {}),
});

async function fetchRoles(): Promise<Array<{ id: string; name: string }>> {
  if (!GUILD_ID || !BOT_TOKEN) {
    console.error("[fetchRoles] Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN");
    return [];
  }
  const res = await fetch(`${API}/guilds/${GUILD_ID}/roles`, { headers: botHeaders() });
  if (!res.ok) {
    console.error(`[fetchRoles] HTTP ${res.status}`, await res.text());
    return [];
  }
  return res.json();
}

async function createRole(name: string, attempt = 0): Promise<string | null> {
  if (!GUILD_ID || !BOT_TOKEN) {
    console.error("[createRole] Missing DISCORD_GUILD_ID or DISCORD_BOT_TOKEN");
    return null;
  }
  const res = await fetch(`${API}/guilds/${GUILD_ID}/roles`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ name }),
  });
  if (res.status === 429) {
    const data = await res.json() as { retry_after?: number };
    const retryAfter = data.retry_after ?? 5;
    if (attempt === 0 && retryAfter <= 10) {
      const waitMs = Math.ceil(retryAfter * 1000) + 500;
      console.log(`[createRole] Rate limited — waiting ${(waitMs / 1000).toFixed(0)}s then retrying`);
      await new Promise(r => setTimeout(r, waitMs));
      return createRole(name, 1);
    }
    console.error(`[createRole] "${name}" rate limited (retry_after: ${retryAfter}s) — wait for the window to clear and try again`);
    return null;
  }
  if (!res.ok) {
    console.error(`[createRole] "${name}" HTTP ${res.status}`, await res.text());
    return null;
  }
  const role = await res.json() as { id: string };

  // If we've used up this rate limit bucket, wait for it to reset before returning
  // so the next createRole call doesn't immediately get 429.
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") ?? "1");
  const resetAfter = parseFloat(res.headers.get("X-RateLimit-Reset-After") ?? "0");
  if (remaining === 0 && resetAfter > 0) {
    console.log(`[createRole] Bucket exhausted — waiting ${resetAfter.toFixed(1)}s for reset`);
    await new Promise(r => setTimeout(r, Math.ceil(resetAfter * 1000) + 200));
  }

  return role.id;
}


export async function editRole(roleId: string, updates: { name?: string; color?: number }, attempt = 0): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  const res = await fetch(`${API}/guilds/${GUILD_ID}/roles/${roleId}`, {
    method: "PATCH",
    headers: botHeaders(true),
    body: JSON.stringify(updates),
  });
  if (res.status === 429) {
    const data = await res.json() as { retry_after?: number };
    const retryAfter = data.retry_after ?? 5;
    if (attempt === 0 && retryAfter <= 10) {
      await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 500));
      return editRole(roleId, updates, 1);
    }
    console.error(`[editRole] role=${roleId} rate limited (retry_after: ${retryAfter}s) — wait for the window to clear`);
    return;
  }
  if (!res.ok) {
    console.error(`[editRole] role=${roleId} HTTP ${res.status}`, await res.text());
    return;
  }
  const remaining = parseInt(res.headers.get("X-RateLimit-Remaining") ?? "1");
  const resetAfter = parseFloat(res.headers.get("X-RateLimit-Reset-After") ?? "0");
  if (remaining === 0 && resetAfter > 0) {
    console.log(`[editRole] Bucket exhausted — waiting ${resetAfter.toFixed(1)}s for reset`);
    await new Promise(r => setTimeout(r, Math.ceil(resetAfter * 1000) + 200));
  }
}

export async function addRoleById(userId: string, roleId: string, attempt = 0): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  if (userId.startsWith("test_")) return;
  try {
    const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, {
      method: "PUT",
      headers: botHeaders(),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({})) as { retry_after?: number };
      const retryAfter = data.retry_after ?? 1;
      if (attempt < 4 && retryAfter <= 15) {
        await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 250));
        return addRoleById(userId, roleId, attempt + 1);
      }
      console.error(`[addRoleById] user=${userId} role=${roleId} rate limited (retry_after: ${retryAfter}s)`);
      return;
    }
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      console.error(`[addRoleById] user=${userId} role=${roleId} status=${res.status}`, text);
    }
  } catch (err) {
    console.error(`[addRoleById] network error user=${userId} role=${roleId}`, err);
  }
}

// Returns { ok, status, message } so callers can diagnose failures (e.g. 403
// "Missing Permissions" when the bot's role is below the target role).
export async function removeRoleById(
  userId: string,
  roleId: string,
  attempt = 0,
): Promise<{ ok: boolean; status: number; message?: string }> {
  if (!GUILD_ID || !BOT_TOKEN) return { ok: false, status: 0, message: "Missing guild/bot config" };
  if (userId.startsWith("test_")) return { ok: true, status: 204 };
  try {
    const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, {
      method: "DELETE",
      headers: botHeaders(),
    });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({})) as { retry_after?: number };
      const retryAfter = data.retry_after ?? 1;
      if (attempt < 4 && retryAfter <= 15) {
        await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 250));
        return removeRoleById(userId, roleId, attempt + 1);
      }
      return { ok: false, status: 429, message: "You are being rate limited." };
    }
    if (res.ok || res.status === 204) return { ok: true, status: res.status };
    let message: string | undefined;
    try { message = (await res.json())?.message; } catch { /* no body */ }
    console.error(`[removeRoleById] user=${userId} role=${roleId} status=${res.status} ${message ?? ""}`);
    return { ok: false, status: res.status, message };
  } catch (err) {
    console.error(`[removeRoleById] network error user=${userId} role=${roleId}`, err);
    return { ok: false, status: 0, message: err instanceof Error ? err.message : "network error" };
  }
}

export async function getGuildRoles(): Promise<Array<{ id: string; name: string }>> {
  return fetchRoles();
}

export async function getGuildChannels(): Promise<Array<{ id: string; name: string; parent_id?: string | null }>> {
  if (!GUILD_ID || !BOT_TOKEN) return [];
  const res = await fetch(`${API}/guilds/${GUILD_ID}/channels`, { headers: botHeaders() });
  return res.ok ? res.json() : [];
}

export async function searchGuildMembers(
  query: string,
  limit = 5,
): Promise<Array<{ id: string; username: string; nick: string | null; globalName: string | null }>> {
  if (!GUILD_ID || !BOT_TOKEN || !query) return [];
  const res = await fetch(
    `${API}/guilds/${GUILD_ID}/members/search?query=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: botHeaders() },
  );
  if (!res.ok) return [];
  const data = await res.json() as Array<{ user: { id: string; username: string; global_name: string | null }; nick: string | null }>;
  return data.map(m => ({ id: m.user.id, username: m.user.username, nick: m.nick, globalName: m.user.global_name }));
}

// Creates a private text channel visible only to the specified roles (+ anyone with Administrator).
// VIEW_CHANNEL(1024) | SEND_MESSAGES(2048) | ATTACH_FILES(32768) | READ_MESSAGE_HISTORY(65536) = 101376
export async function createTextChannel(
  name: string,
  categoryId: string | null,
  allowedRoleIds: string[],
): Promise<{ id: string; error?: never } | { id: null; error: string }> {
  if (!GUILD_ID || !BOT_TOKEN) return { id: null, error: "Bot credentials not configured." };
  const BOT_USER_ID = process.env.DISCORD_CLIENT_ID ?? "";
  const ALLOW = "101376";
  const DENY_VIEW = "1024";

  const permissionOverwrites = [
    { id: GUILD_ID, type: 0, allow: "0", deny: DENY_VIEW },  // @everyone: deny view
    ...(BOT_USER_ID ? [{ id: BOT_USER_ID, type: 1, allow: ALLOW, deny: "0" }] : []), // bot user: always allow
    ...allowedRoleIds.map(id => ({ id, type: 0, allow: ALLOW, deny: "0" })),
  ];

  const body: Record<string, unknown> = { name, type: 0, permission_overwrites: permissionOverwrites };
  if (categoryId) body.parent_id = categoryId;

  const res = await fetch(`${API}/guilds/${GUILD_ID}/channels`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[createTextChannel]", text);
    let reason = `Discord API error ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.code === 50013) reason = "Bot is missing Manage Channels permission.";
      else if (json.code === 10003) reason = "Invalid category ID — run `/setmatchcategory` again.";
      else if (json.message) reason = json.message;
    } catch { /* ignore */ }
    return { id: null, error: reason };
  }
  const channel: { id: string } = await res.json();
  return { id: channel.id };
}

// Fetch guild roles once, then remove all matching roles from every given user.
export async function stripRolesFromUsers(userIds: string[], roleNames: string[]): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN || !userIds.length || !roleNames.length) return;
  const allRoles = await fetchRoles();
  const roleIds = roleNames
    .map(name => allRoles.find(r => r.name === name)?.id)
    .filter(Boolean) as string[];
  if (!roleIds.length) return;
  await Promise.all(userIds.flatMap(uid => roleIds.map(rid => removeRoleById(uid, rid))));
}

export async function addRole(userId: string, roleName: string): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  const roles = await fetchRoles();
  const existing = roles.find((r) => r.name === roleName);
  const roleId = existing ? existing.id : await createRole(roleName);
  if (roleId) await addRoleById(userId, roleId);
}

export async function removeRole(userId: string, roleName: string): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  const roles = await fetchRoles();
  const role = roles.find((r) => r.name === roleName);
  if (!role) return;
  await removeRoleById(userId, role.id);
}

export async function timeoutMember(userId: string, durationMs: number): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  if (userId.startsWith("test_")) return;
  // Discord clears an active timeout only when this field is explicit null —
  // a past timestamp is not equivalent and can be rejected or ignored.
  const until = durationMs > 0 ? new Date(Date.now() + durationMs).toISOString() : null;
  const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}`, {
    method: "PATCH",
    headers: botHeaders(true),
    body: JSON.stringify({ communication_disabled_until: until }),
  });
  if (!res.ok) console.error(`[timeoutMember] user=${userId} status=${res.status}`, await res.text());
}

export async function banMember(userId: string): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  if (userId.startsWith("test_")) return;
  const res = await fetch(`${API}/guilds/${GUILD_ID}/bans/${userId}`, {
    method: "PUT",
    headers: botHeaders(true),
    body: JSON.stringify({ delete_message_seconds: 0 }),
  });
  if (!res.ok && res.status !== 204) console.error(`[banMember] user=${userId} status=${res.status}`, await res.text());
}

export async function unbanMember(userId: string): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  const res = await fetch(`${API}/guilds/${GUILD_ID}/bans/${userId}`, {
    method: "DELETE",
    headers: botHeaders(),
  });
  if (!res.ok && res.status !== 404 && res.status !== 204)
    console.error(`[unbanMember] user=${userId} status=${res.status}`, await res.text());
}

// Returns the member's current role IDs, or null if they aren't in the guild /
// the fetch failed. Lets callers remove only roles a member actually has.
export async function getMemberRoleIds(userId: string, attempt = 0): Promise<string[] | null> {
  if (!GUILD_ID || !BOT_TOKEN) return null;
  if (userId.startsWith("test_")) return [];
  try {
    const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}`, { headers: botHeaders() });
    if (res.status === 429) {
      const data = await res.json().catch(() => ({})) as { retry_after?: number };
      const retryAfter = data.retry_after ?? 1;
      if (attempt < 4 && retryAfter <= 15) {
        await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 250));
        return getMemberRoleIds(userId, attempt + 1);
      }
      console.error(`[getMemberRoleIds] user=${userId} rate limited (retry_after: ${retryAfter}s)`);
      return null;
    }
    if (!res.ok) return null;
    const data = await res.json() as { roles?: string[] };
    return Array.isArray(data.roles) ? data.roles : [];
  } catch {
    return null;
  }
}

// Removes the given role IDs from each member, but only the ones they actually
// have — avoids the no-op calls that trip Discord's rate limiter. Sequential,
// and removeRoleById backs off on 429.
export async function stripRoleIdsFromMembers(userIds: string[], roleIds: string[]): Promise<void> {
  const roleSet = new Set(roleIds.filter(Boolean));
  if (roleSet.size === 0) return;
  for (const uid of userIds) {
    if (!uid || uid.startsWith("test_")) continue;
    const have = await getMemberRoleIds(uid);
    if (!have) continue;
    for (const rid of have) {
      if (roleSet.has(rid)) await removeRoleById(uid, rid);
    }
  }
}

export async function isGuildMember(userId: string): Promise<boolean> {
  if (!GUILD_ID || !BOT_TOKEN) return true; // fail open if not configured
  const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}`, {
    headers: botHeaders(),
  });
  return res.ok;
}

export async function sendDm(userId: string, content: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const dmRes = await fetch(`${API}/users/@me/channels`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!dmRes.ok) {
    console.error(`[sendDm] user=${userId} failed to open DM channel status=${dmRes.status}`);
    return;
  }
  const { id: channelId } = await dmRes.json() as { id: string };
  const msgRes = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ content }),
  });
  if (!msgRes.ok) console.error(`[sendDm] user=${userId} failed to send message status=${msgRes.status}`, await msgRes.text());
}

export type DiscordEmbed = {
  color?: number;
  description?: string;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
};

export async function sendChannelMessage(channelId: string, content: string, embeds?: DiscordEmbed[]): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ content, ...(embeds ? { embeds } : {}) }),
  });
  if (!res.ok) console.error(`[sendChannelMessage] channel=${channelId} status=${res.status}`, await res.text());
}

export async function deleteChannel(channelId: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  try {
    const res = await fetch(`${API}/channels/${channelId}`, {
      method: "DELETE",
      headers: botHeaders(),
    });
    if (!res.ok && res.status !== 404) {
      console.error(`[deleteChannel] channel=${channelId} status=${res.status}`, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[deleteChannel] network error channel=${channelId}`, err);
    return false;
  }
}

// Creates a Discord category channel (type 4). Returns its ID.
export async function createCategory(
  name: string,
): Promise<{ id: string; error?: never } | { id: null; error: string }> {
  if (!GUILD_ID || !BOT_TOKEN) return { id: null, error: "Bot credentials not configured." };
  const res = await fetch(`${API}/guilds/${GUILD_ID}/channels`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ name, type: 4 }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[createCategory]", text);
    return { id: null, error: `Discord API error ${res.status}` };
  }
  const channel: { id: string } = await res.json();
  return { id: channel.id };
}

// Fetch or create all named roles in one batch. Returns name → id map.
export async function ensureRoles(names: string[]): Promise<Record<string, string>> {
  if (!GUILD_ID || !BOT_TOKEN) return {};
  const existing = await fetchRoles();
  const map: Record<string, string> = {};
  existing.forEach((r) => { if (names.includes(r.name)) map[r.name] = r.id; });

  const missing = names.filter(n => !map[n]);
  for (const name of missing) {
    const id = await createRole(name);
    if (id) map[name] = id;
  }
  return map;
}
