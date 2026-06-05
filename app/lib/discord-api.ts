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
      const data = await res.json() as { retry_after?: number };
      const retryAfter = data.retry_after ?? 1;
      if (attempt === 0 && retryAfter <= 10) {
        await new Promise(r => setTimeout(r, Math.ceil(retryAfter * 1000) + 200));
        return addRoleById(userId, roleId, 1);
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

export async function removeRoleById(userId: string, roleId: string): Promise<void> {
  if (!GUILD_ID || !BOT_TOKEN) return;
  if (userId.startsWith("test_")) return;
  try {
    const res = await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}/roles/${roleId}`, {
      method: "DELETE",
      headers: botHeaders(),
    });
    if (!res.ok && res.status !== 204) {
      const text = await res.text();
      console.error(`[removeRoleById] user=${userId} role=${roleId} status=${res.status}`, text);
    }
  } catch (err) {
    console.error(`[removeRoleById] network error user=${userId} role=${roleId}`, err);
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
  await fetch(`${API}/guilds/${GUILD_ID}/members/${userId}/roles/${role.id}`, {
    method: "DELETE",
    headers: botHeaders(),
  });
}

export async function sendChannelMessage(channelId: string, content: string): Promise<void> {
  if (!BOT_TOKEN) return;
  const res = await fetch(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: botHeaders(true),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) console.error("[sendChannelMessage]", await res.text());
}

export async function deleteChannel(channelId: string): Promise<void> {
  if (!BOT_TOKEN) return;
  await fetch(`${API}/channels/${channelId}`, {
    method: "DELETE",
    headers: botHeaders(),
  });
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
