// Binary parser for Rocket League .replay file headers.
// Extracts per-player scoreboard stats (Goals, Assists, Saves, Shots, Score).
// Demo counts are stored in network frames, not the header, and require
// frame-level parsing — they are not returned here.

export type PlayerStat = {
  name: string;
  team: 0 | 1;
  score: number;
  goals: number;
  assists: number;
  saves: number;
  shots: number;
};

export type ReplayData = {
  team0Score: number;
  team1Score: number;
  players: PlayerStat[];
  date: string | null;
  mapName: string | null;
  replayId: string | null; // unique per replay file ("Id"), used to reject duplicates
  // Present when parseReplay is called with debug=true
  _rawProps?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Low-level binary reader
// ---------------------------------------------------------------------------

type S = { buf: Buffer; pos: number };

const u8  = (s: S): number => s.buf[s.pos++];
const i32 = (s: S): number => { const v = s.buf.readInt32LE(s.pos);   s.pos += 4; return v; };
const u32 = (s: S): number => { const v = s.buf.readUInt32LE(s.pos);  s.pos += 4; return v; };
const f32 = (s: S): number => { const v = s.buf.readFloatLE(s.pos);   s.pos += 4; return v; };
const skip = (s: S, n: number): void => { s.pos += n; };

function readStr(s: S): string {
  const len = i32(s);
  if (len === 0) return "";
  const isUtf16 = len < 0;
  const byteLen = isUtf16 ? (-len) * 2 : len;
  if (byteLen > 8192) throw new Error(`Implausible string length ${byteLen} at offset ${s.pos}`);
  if (s.pos + byteLen > s.buf.length) throw new Error(`String extends past end of buffer at offset ${s.pos}`);
  const slice = s.buf.subarray(s.pos, s.pos + byteLen);
  s.pos += byteLen;
  if (isUtf16) {
    let result = "";
    for (let i = 0; i < slice.length - 1; i += 2) {
      const code = slice[i] | (slice[i + 1] << 8);
      if (code === 0) break;
      result += String.fromCharCode(code);
    }
    return result;
  }
  const nullIdx = slice.indexOf(0);
  return slice.subarray(0, nullIdx === -1 ? byteLen : nullIdx).toString("latin1");
}

// ---------------------------------------------------------------------------
// Property map reader
// ---------------------------------------------------------------------------

function readProps(s: S, depth = 0): Record<string, unknown> {
  if (depth > 6) throw new Error("Property nesting too deep — possibly corrupt replay");
  const props: Record<string, unknown> = {};
  for (let guard = 0; guard < 2048; guard++) {
    const name = readStr(s);
    if (!name || name === "None") break;
    const kind = readStr(s);

    // Read the 8-byte size field. propSize = number of VALUE bytes (after the
    // 8-byte size field). Skip target = sizeStart + 8 + propSize.
    const sizeStart = s.pos;
    const sizeLo = u32(s);
    const sizeHi = u32(s);
    const propSize = sizeLo + sizeHi * 0x100000000; // value bytes only

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
        value = u8(s) !== 0;
        break;
      case "QWordProperty": {
        const lo = u32(s);
        const hi = u32(s);
        value = lo + hi * 0x100000000;
        break;
      }
      case "ByteProperty": {
        const enumType  = readStr(s);
        const enumValue = readStr(s);
        value = { enumType, enumValue };
        break;
      }
      case "StructProperty": {
        // propSize = struct content bytes only; typeName is read separately.
        const typeName = readStr(s);
        switch (typeName) {
          case "Vector":
            value = { type: typeName, x: f32(s), y: f32(s), z: f32(s) };
            break;
          case "Rotator":
            value = { type: typeName, pitch: i32(s), yaw: i32(s), roll: i32(s) };
            break;
          default:
            // propSize = content bytes only (excludes typeName string).
            // s.pos is already past typeName, so advance by propSize.
            s.pos += propSize;
            value = { type: typeName, skipped: true };
            break;
        }
        break;
      }
      case "ArrayProperty": {
        const count = u32(s);
        if (count > 512) {
          // Sanity guard — use size to skip rather than crash
          s.pos = sizeStart + 8 + propSize;
          value = [];
          break;
        }
        const items: Record<string, unknown>[] = [];
        for (let i = 0; i < count; i++) items.push(readProps(s, depth + 1));
        value = items;
        break;
      }
      default:
        // Unrecognised property kind — skip using the size field instead of throwing
        s.pos = sizeStart + 8 + propSize;
        value = `[${kind}]`;
        break;
    }
    props[name] = value;
  }
  return props;
}

// ---------------------------------------------------------------------------
// Public parser entry point
// ---------------------------------------------------------------------------

const LABEL = "TAGame.Replay_Soccar_TA";
const LABEL_LEN = LABEL.length + 1; // 24 — includes null terminator

export function parseReplay(buf: Buffer, debug = false): ReplayData {
  const s: S = { buf, pos: 0 };

  skip(s, 4); // header_size  (u32)
  skip(s, 4); // header_crc   (u32)
  u32(s);     // major_version
  u32(s);     // minor_version

  // Newer replays (major >= 868, minor >= 18) include a net_version u32 here.
  // Detect by peeking: if the next 4 bytes equal LABEL_LEN (24) it's the label
  // length prefix; otherwise it's net_version and we skip it first.
  if (buf.readInt32LE(s.pos) !== LABEL_LEN) {
    skip(s, 4); // net_version
  }

  const label = readStr(s);
  if (label !== LABEL) {
    throw new Error(
      `Unexpected replay label "${label}" — expected "${LABEL}". Is this a Rocket League replay?`
    );
  }

  const props = readProps(s);

  const team0Score = typeof props["Team0Score"] === "number" ? (props["Team0Score"] as number) : 0;
  const team1Score = typeof props["Team1Score"] === "number" ? (props["Team1Score"] as number) : 0;
  const date       = typeof props["Date"]    === "string"  ? (props["Date"]    as string) : null;
  const mapName    = typeof props["MapName"] === "string"  ? (props["MapName"] as string) : null;
  const replayId   = typeof props["Id"]      === "string"  ? (props["Id"]      as string) : null;

  const rawPlayers = Array.isArray(props["PlayerStats"])
    ? (props["PlayerStats"] as Record<string, unknown>[])
    : [];

  const players: PlayerStat[] = rawPlayers
    .filter(p => !p["bBot"])
    .map(p => ({
      name:    typeof p["Name"]    === "string" ? (p["Name"]    as string) : "Unknown",
      team:    (typeof p["Team"]   === "number" && (p["Team"] as number) === 0 ? 0 : 1) as 0 | 1,
      score:   typeof p["Score"]   === "number" ? (p["Score"]   as number) : 0,
      goals:   typeof p["Goals"]   === "number" ? (p["Goals"]   as number) : 0,
      assists: typeof p["Assists"] === "number" ? (p["Assists"] as number) : 0,
      saves:   typeof p["Saves"]   === "number" ? (p["Saves"]   as number) : 0,
      shots:   typeof p["Shots"]   === "number" ? (p["Shots"]   as number) : 0,
    }));

  return {
    team0Score,
    team1Score,
    players,
    date,
    mapName,
    replayId,
    _rawProps: debug ? (sanitiseForJson(props) as Record<string, unknown>) : undefined,
  };
}

// JSON.stringify can't handle bigints; replace them with strings
function sanitiseForJson(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sanitiseForJson);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, sanitiseForJson(val)]),
    );
  }
  return v;
}
