// Safe header parser for Rocket League .replay files.
//
// This module parses the replay header and optional BakkesMod trailer metadata.
// PlayerStats.OnlineID contains stable IDs for several platforms, while Epic
// commonly writes zero there. Newer replays also serialize EpicAccountId inside
// PlayerStats.PlayerID (UniqueNetId); older BakkesMod replays may carry it in
// MMR trailer records. A full network-parser result can still be attached with
// mergeNetworkIdentities() when neither header source is available.

export type ReplayPlatform =
  | "steam"
  | "epic"
  | "playstation"
  | "xbox"
  | "switch"
  | "psynet"
  | "unknown";

export type IdentitySource = "header" | "network" | "bakkesmod";

export type PlayerStat = {
  name: string;
  team: 0 | 1;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;

  // Identity fields are strings on purpose. Steam/Xbox IDs exceed Number's
  // safe-integer range and must never be converted to JavaScript numbers.
  platform: ReplayPlatform | null;
  onlineId: string | null;
  identityKey: string | null; // e.g. "steam:76561198220214291"
  identitySource: IdentitySource | null;
};

export type ReplayData = {
  team0Score: number;
  team1Score: number;
  players: PlayerStat[];
  date: string | null;
  mapName: string | null;
  replayId: string | null;
  gameType: string;
  majorVersion: number;
  minorVersion: number;
  netVersion: number | null;
  warnings: string[];
  _rawProps?: Record<string, unknown>;
};

// Output expected from a full network parser. A reservation/UniqueId record
// should provide the name and platform remote ID from the same network record.
export type NetworkPlayerIdentity = {
  name: string;
  team?: 0 | 1;
  platform: ReplayPlatform;
  onlineId: string;
};

export class ReplayParseError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = "ReplayParseError";
    this.offset = offset;
  }
}

// ---------------------------------------------------------------------------
// Low-level binary reader
// ---------------------------------------------------------------------------

type Reader = {
  buf: Buffer;
  pos: number;
  limit: number;
};

const MAX_REPLAY_BYTES = 64 * 1024 * 1024;
const MAX_STRING_BYTES = 64 * 1024;
const MAX_PROPERTIES = 4096;
const MAX_ARRAY_ITEMS = 1024;
const MAX_PROPERTY_DEPTH = 8;

function requireBytes(s: Reader, count: number, context: string): void {
  if (!Number.isSafeInteger(count) || count < 0 || s.pos + count > s.limit) {
    throw new ReplayParseError(`Unexpected end of replay while reading ${context}`, s.pos);
  }
}

function u8(s: Reader): number {
  requireBytes(s, 1, "u8");
  return s.buf[s.pos++];
}

function i32(s: Reader): number {
  requireBytes(s, 4, "i32");
  const value = s.buf.readInt32LE(s.pos);
  s.pos += 4;
  return value;
}

function u32(s: Reader): number {
  requireBytes(s, 4, "u32");
  const value = s.buf.readUInt32LE(s.pos);
  s.pos += 4;
  return value;
}

function u64(s: Reader): bigint {
  requireBytes(s, 8, "u64");
  const value = s.buf.readBigUInt64LE(s.pos);
  s.pos += 8;
  return value;
}

function f32(s: Reader): number {
  requireBytes(s, 4, "f32");
  const value = s.buf.readFloatLE(s.pos);
  s.pos += 4;
  return value;
}

function skip(s: Reader, count: number, context = "bytes"): void {
  requireBytes(s, count, context);
  s.pos += count;
}

function checkedSize(value: bigint, s: Reader, context: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ReplayParseError(`${context} exceeds JavaScript's safe size range`, s.pos);
  }
  const size = Number(value);
  if (size > s.limit - s.pos) {
    throw new ReplayParseError(`${context} extends past the replay header`, s.pos);
  }
  return size;
}

function readStr(s: Reader): string {
  const length = i32(s);
  if (length === 0) return "";
  if (length === -0x80000000) {
    throw new ReplayParseError("Invalid FString length", s.pos - 4);
  }

  const utf16 = length < 0;
  const characterCount = Math.abs(length);
  const byteLength = utf16 ? characterCount * 2 : characterCount;

  if (!Number.isSafeInteger(byteLength) || byteLength > MAX_STRING_BYTES) {
    throw new ReplayParseError(`Implausible FString length ${byteLength}`, s.pos - 4);
  }
  requireBytes(s, byteLength, "FString");

  const slice = s.buf.subarray(s.pos, s.pos + byteLength);
  s.pos += byteLength;

  if (utf16) {
    const value = slice.toString("utf16le");
    const terminator = value.indexOf("\0");
    return terminator === -1 ? value : value.slice(0, terminator);
  }

  const terminator = slice.indexOf(0);
  return slice.subarray(0, terminator === -1 ? slice.length : terminator).toString("latin1");
}

function canReadGameTypeAt(s: Reader, offset: number): boolean {
  try {
    const probe: Reader = { buf: s.buf, pos: offset, limit: s.limit };
    return readStr(probe).startsWith("TAGame.Replay_");
  } catch {
    return false;
  }
}

function encodeAnsiFString(value: string): Buffer {
  const text = Buffer.from(`${value}\0`, "latin1");
  const encoded = Buffer.allocUnsafe(4 + text.length);
  encoded.writeInt32LE(text.length, 0);
  text.copy(encoded, 4);
  return encoded;
}

function findTaggedStringProperty(
  s: Reader,
  start: number,
  end: number,
  propertyName: string,
): string | null {
  const marker = encodeAnsiFString(propertyName);
  const offset = s.buf.indexOf(marker, start);
  if (offset < start || offset + marker.length >= end) return null;

  try {
    const probe: Reader = { buf: s.buf, pos: offset + marker.length, limit: end };
    if (readStr(probe) !== "StrProperty") return null;
    checkedSize(u64(probe), probe, propertyName);
    return readStr(probe);
  } catch {
    return null;
  }
}

function findBakkesModEpicAccountIds(buf: Buffer): string[] {
  const prefix = Buffer.from("MMR:Epic|", "ascii");
  const ids = new Set<string>();
  let offset = 0;

  while ((offset = buf.indexOf(prefix, offset)) !== -1) {
    const idStart = offset + prefix.length;
    const idEnd = idStart + 32;
    if (idEnd <= buf.length) {
      const candidate = buf.toString("ascii", idStart, idEnd).toLowerCase();
      if (/^[0-9a-f]{32}$/.test(candidate) && buf[idEnd] === 0x7c) ids.add(candidate);
    }
    offset = idStart;
  }

  return [...ids];
}

// ---------------------------------------------------------------------------
// Header property map reader
// ---------------------------------------------------------------------------

type ByteProperty = {
  enumType: string;
  enumValue: string;
};

function readProps(s: Reader, boolWidth: 1 | 4, depth = 0): Record<string, unknown> {
  if (depth > MAX_PROPERTY_DEPTH) {
    throw new ReplayParseError("Property nesting is too deep", s.pos);
  }

  const props: Record<string, unknown> = {};

  for (let guard = 0; guard < MAX_PROPERTIES; guard++) {
    const name = readStr(s);
    if (!name || name === "None") return props;

    const kind = readStr(s);
    const sizeFieldOffset = s.pos;
    const propertySize = checkedSize(u64(s), s, `Property ${name}`);

    let value: unknown;

    switch (kind) {
      case "IntProperty":
        value = i32(s);
        break;

      case "FloatProperty":
        value = f32(s);
        break;

      case "StrProperty":
      case "NameProperty":
        value = readStr(s);
        break;

      case "BoolProperty":
        value = (boolWidth === 4 ? i32(s) : u8(s)) !== 0;
        break;

      case "QWordProperty":
        // Returning a decimal string is intentional and mandatory. Reading
        // this as Number silently changes SteamID64 trailing digits.
        value = u64(s).toString();
        break;

      case "ByteProperty": {
        // Rocket League's property size describes the enum value bytes, while
        // the enum type is serialized as tag metadata. Some files omit the
        // second FString entirely.
        const enumType = readStr(s);
        const bytesAfterSize = s.pos - (sizeFieldOffset + 8);
        const enumValue = bytesAfterSize < propertySize ? readStr(s) : "None";
        value = { enumType, enumValue } satisfies ByteProperty;
        break;
      }

      case "StructProperty": {
        const typeName = readStr(s);
        switch (typeName) {
          case "Vector":
            value = { type: typeName, x: f32(s), y: f32(s), z: f32(s) };
            break;
          case "Rotator":
            value = { type: typeName, pitch: i32(s), yaw: i32(s), roll: i32(s) };
            break;
          case "UniqueNetId":
            // Epic PlayerStats.PlayerID is commonly a tagged property map and
            // carries the stable EpicAccountId that OnlineID leaves as zero.
            // Other platforms/versions may use an opaque binary layout, so
            // probe in a bounded child reader and fall back without desyncing.
            {
              const contentStart = s.pos;
              const contentEnd = contentStart + propertySize;
              if (contentEnd > s.limit) {
                throw new ReplayParseError(`Invalid UniqueNetId size for ${name}`, s.pos);
              }

              const nested: Reader = { buf: s.buf, pos: contentStart, limit: contentEnd };
              const epicAccountId = findTaggedStringProperty(
                s,
                contentStart,
                contentEnd,
                "EpicAccountId",
              );
              try {
                const properties = readProps(nested, boolWidth, depth + 1);
                value = {
                  type: typeName,
                  properties: epicAccountId ? { ...properties, EpicAccountId: epicAccountId } : properties,
                };
              } catch {
                value = epicAccountId
                  ? { type: typeName, properties: { EpicAccountId: epicAccountId } }
                  : { type: typeName, skipped: true };
              }
              s.pos = contentEnd;
            }
            break;
          default:
            skip(s, propertySize, `StructProperty ${name}`);
            value = { type: typeName, skipped: true };
            break;
        }
        break;
      }

      case "ArrayProperty": {
        const count = u32(s);
        if (count > MAX_ARRAY_ITEMS) {
          const declaredEnd = sizeFieldOffset + 8 + propertySize;
          if (declaredEnd < s.pos || declaredEnd > s.limit) {
            throw new ReplayParseError(`Invalid ArrayProperty size for ${name}`, s.pos);
          }
          s.pos = declaredEnd;
          value = [];
          break;
        }

        const items: Record<string, unknown>[] = [];
        for (let index = 0; index < count; index++) {
          items.push(readProps(s, boolWidth, depth + 1));
        }
        value = items;
        break;
      }

      default: {
        const declaredEnd = sizeFieldOffset + 8 + propertySize;
        if (declaredEnd < s.pos || declaredEnd > s.limit) {
          throw new ReplayParseError(`Invalid size for unsupported property ${name}`, s.pos);
        }
        s.pos = declaredEnd;
        value = `[Unsupported ${kind}]`;
        break;
      }
    }

    if (s.pos > s.limit) {
      throw new ReplayParseError(`Property ${name} extends past the replay header`, s.pos);
    }
    props[name] = value;
  }

  throw new ReplayParseError("Property count exceeds safety limit", s.pos);
}

// ---------------------------------------------------------------------------
// Value conversion helpers
// ---------------------------------------------------------------------------

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asIdentifier(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && trimmed !== "0" ? trimmed : null;
  }
  if (typeof value === "bigint") return value === BigInt(0) ? null : value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return value.toString();
  }
  return null;
}

export function normalisePlatform(value: unknown): ReplayPlatform | null {
  let raw: string | null = null;

  if (typeof value === "string") {
    raw = value;
  } else if (value && typeof value === "object") {
    const byteProperty = value as Partial<ByteProperty>;
    raw = byteProperty.enumValue && byteProperty.enumValue !== "None"
      ? byteProperty.enumValue
      : byteProperty.enumType ?? null;
  }

  if (!raw) return null;

  const platform = raw
    .replace(/^OnlinePlatform_/i, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();

  if (platform.includes("steam")) return "steam";
  if (platform.includes("epic")) return "epic";
  if (platform.includes("ps4") || platform.includes("ps5") || platform.includes("playstation")) {
    return "playstation";
  }
  // "Dingo" was Xbox One's internal codename; Rocket League still emits
  // OnlinePlatform_Dingo for Xbox accounts rather than an "xbox"-named value.
  if (platform.includes("xbox") || platform.includes("dingo")) return "xbox";
  if (platform.includes("switch")) return "switch";
  if (platform.includes("psynet")) return "psynet";
  return "unknown";
}

function identityKey(platform: ReplayPlatform | null, onlineId: string | null): string | null {
  return platform && platform !== "unknown" && onlineId ? `${platform}:${onlineId}` : null;
}

function uniqueNetIdProperties(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  const properties = (value as { properties?: unknown }).properties;
  return properties && typeof properties === "object" && !Array.isArray(properties)
    ? properties as Record<string, unknown>
    : null;
}

// ---------------------------------------------------------------------------
// Public parser entry point
// ---------------------------------------------------------------------------

export function parseReplay(buf: Buffer, debug = false): ReplayData {
  if (!Buffer.isBuffer(buf)) throw new TypeError("parseReplay expects a Buffer");
  if (buf.length < 32) throw new ReplayParseError("Replay is too small", 0);
  if (buf.length > MAX_REPLAY_BYTES) {
    throw new ReplayParseError(`Replay exceeds ${MAX_REPLAY_BYTES} byte safety limit`, 0);
  }

  let firstError: unknown;
  try {
    return parseReplayWithBoolWidth(buf, debug, 1);
  } catch (error) {
    firstError = error;
  }

  try {
    return parseReplayWithBoolWidth(buf, debug, 4);
  } catch {
    throw firstError;
  }
}

function parseReplayWithBoolWidth(buf: Buffer, debug: boolean, boolWidth: 1 | 4): ReplayData {
  const s: Reader = { buf, pos: 0, limit: buf.length };

  const headerSize = u32(s);
  u32(s); // header CRC

  const headerEnd = 8 + headerSize;
  if (headerSize === 0 || headerEnd > buf.length) {
    throw new ReplayParseError("Invalid replay header size", 0);
  }
  s.limit = headerEnd;

  const majorVersion = u32(s);
  const minorVersion = u32(s);

  // Some replay versions insert net_version before the game type FString.
  // Detect the FString itself rather than assuming the Soccar label length;
  // the old fixed-length check misparsed Hoops and other replay types.
  let netVersion: number | null = null;
  if (!canReadGameTypeAt(s, s.pos)) {
    netVersion = u32(s);
  }

  const gameType = readStr(s);
  if (!gameType.startsWith("TAGame.Replay_")) {
    throw new ReplayParseError(`Unexpected replay game type ${JSON.stringify(gameType)}`, s.pos);
  }

  const props = readProps(s, boolWidth);
  const rawPlayers = Array.isArray(props.PlayerStats)
    ? props.PlayerStats as Record<string, unknown>[]
    : [];

  const warnings: string[] = [];
  const players: PlayerStat[] = [];

  for (const rawPlayer of rawPlayers) {
    if (rawPlayer.bBot === true) continue;

    const rawTeam = asNumber(rawPlayer.Team, -1);
    if (rawTeam !== 0 && rawTeam !== 1) {
      warnings.push(`Skipped player with invalid team value ${rawTeam}`);
      continue;
    }

    const playerId = uniqueNetIdProperties(rawPlayer.PlayerID);
    const platform = normalisePlatform(playerId?.Platform ?? rawPlayer.Platform);
    const headerOnlineId = asIdentifier(rawPlayer.OnlineID);
    const epicAccountId = asIdentifier(playerId?.EpicAccountId);
    const onlineId = platform === "epic" ? epicAccountId ?? headerOnlineId : headerOnlineId;
    const key = identityKey(platform, onlineId);
    const name = asString(rawPlayer.Name) ?? "Unknown";

    if (platform === "epic" && !onlineId) {
      warnings.push(`Epic account ID is unavailable for ${JSON.stringify(name)}`);
    }

    players.push({
      name,
      team: rawTeam,
      score: asNumber(rawPlayer.Score),
      goals: asNumber(rawPlayer.Goals),
      assists: asNumber(rawPlayer.Assists),
      saves: asNumber(rawPlayer.Saves),
      shots: asNumber(rawPlayer.Shots),
      platform,
      onlineId,
      identityKey: key,
      identitySource: key ? "header" : null,
    });
  }

  // Older replay headers may omit PlayerID, but BakkesMod's replay trailer
  // can still carry stable Epic IDs. Only associate this fallback when the
  // mapping is unambiguous after excluding IDs already resolved from headers.
  const unresolvedEpicPlayers = players.filter(player =>
    player.platform === "epic" && !player.onlineId
  );
  const knownEpicIds = new Set(
    players
      .filter(player => player.platform === "epic" && player.onlineId)
      .map(player => player.onlineId as string),
  );
  const unclaimedBakkesModIds = findBakkesModEpicAccountIds(buf)
    .filter(id => !knownEpicIds.has(id));

  if (unresolvedEpicPlayers.length === 1 && unclaimedBakkesModIds.length === 1) {
    const player = unresolvedEpicPlayers[0];
    player.onlineId = unclaimedBakkesModIds[0];
    player.identityKey = identityKey(player.platform, player.onlineId);
    player.identitySource = "bakkesmod";

    const warning = `Epic account ID is unavailable for ${JSON.stringify(player.name)}`;
    const warningIndex = warnings.indexOf(warning);
    if (warningIndex !== -1) warnings.splice(warningIndex, 1);
  } else if (unresolvedEpicPlayers.length > 0 && unclaimedBakkesModIds.length > 0) {
    warnings.push(
      `Found ${unclaimedBakkesModIds.length} unclaimed BakkesMod Epic ID(s) for `
      + `${unresolvedEpicPlayers.length} unresolved Epic player(s); automatic association refused`,
    );
  }

  return {
    team0Score: asNumber(props.Team0Score),
    team1Score: asNumber(props.Team1Score),
    players,
    date: asString(props.Date),
    mapName: asString(props.MapName),
    replayId: asString(props.Id),
    gameType,
    majorVersion,
    minorVersion,
    netVersion,
    warnings,
    _rawProps: debug ? sanitiseForJson(props) as Record<string, unknown> : undefined,
  };
}

// Attach identities produced by a maintained full network parser. Matching is
// deliberately exact and unique; fuzzy matching belongs in the application
// review flow, not inside a binary parser.
export function mergeNetworkIdentities(
  replay: ReplayData,
  identities: readonly NetworkPlayerIdentity[],
): ReplayData {
  const warnings = [...replay.warnings];
  const used = new Set<number>();

  const players = replay.players.map(player => {
    const candidates = identities
      .map((identity, index) => ({ identity, index }))
      .filter(({ identity, index }) =>
        !used.has(index)
        && identity.name === player.name
        && (identity.team === undefined || identity.team === player.team)
        && identity.onlineId.trim() !== ""
        && identity.onlineId !== "0"
      );

    if (candidates.length !== 1) {
      if (candidates.length > 1) {
        warnings.push(`Ambiguous network identity for ${JSON.stringify(player.name)}`);
      }
      return player;
    }

    const { identity, index } = candidates[0];
    const onlineId = identity.onlineId.trim();
    const key = identityKey(identity.platform, onlineId);
    if (!key) return player;

    if (player.identityKey && player.identityKey !== key) {
      warnings.push(
        `Header/network identity conflict for ${JSON.stringify(player.name)}: `
        + `${player.identityKey} vs ${key}`,
      );
      return player;
    }

    used.add(index);
    return {
      ...player,
      platform: identity.platform,
      onlineId,
      identityKey: key,
      identitySource: "network" as const,
    };
  });

  return { ...replay, players, warnings };
}

function sanitiseForJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitiseForJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, child]) => [key, sanitiseForJson(child)]),
    );
  }
  return value;
}
