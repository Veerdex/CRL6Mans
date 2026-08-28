// Rocket League .replay network-stream (per-frame actor/attribute) decoder.
//
// Ported from tools/replay-analyzer.html's parseReplay() — that file is the
// proven reference implementation (see its own header comment for provenance:
// an independent re-implementation of the publicly documented wire format
// used by the boxcars project, no code copied). This module intentionally
// mirrors it property-for-property so the bit stream stays synchronized:
// every replicated attribute on every actor in every frame must be decoded
// correctly just to reach the next one, even though only Demolish-family
// attributes are ultimately read out.
//
// One deliberate deviation from the reference: the reference collects every
// decoded attribute update into a flat array for the whole match, then
// post-processes it. For a multi-hundred-frame match run through a Vercel
// function (and possibly several times per series upload) that's an
// unbounded memory footprint. This module folds the same switch inline as
// each attribute is decoded, keeping only the running priNameByActor/
// carToPri/demolishRaw maps — bit-identical output, bounded memory. Do NOT
// clear carToPri/priNameByActor entries when an actor despawns: the
// reference never does (its event log has no deletions), and cars are
// destroyed/respawned on every kickoff — "fixing" that would silently change
// demo counts because demolitions resolve against the FINAL car->PRI state,
// not live.

export type DemoParseInput = {
  buf: Buffer;
  headerEnd: number;
  majorVersion: number;
  minorVersion: number;
  netVersion: number | null;
  numFrames: number;
  maxChannels: number;
  matchType: string | null;
  buildVersion: string | null;
};

export type PlayerDemoCounts = {
  demos: number;
  demoed: number;
};

export type DemoParseResult = {
  counts: Map<string, PlayerDemoCounts>;
  frameCoverage: number;
};

// ---------------------------------------------------------------------
// Byte-level reader (body metadata; always byte-aligned)
// ---------------------------------------------------------------------
function makeByteReader(bytes: Buffer) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const state = { pos: 0 };
  const winDecoder = new TextDecoder("windows-1252");
  const utf16Decoder = new TextDecoder("utf-16le");
  return {
    get pos() { return state.pos; },
    set pos(v: number) { state.pos = v; },
    u32() { const v = dv.getUint32(state.pos, true); state.pos += 4; return v; },
    i32() { const v = dv.getInt32(state.pos, true); state.pos += 4; return v; },
    f32() { const v = dv.getFloat32(state.pos, true); state.pos += 4; return v; },
    bytes(n: number) { const s = bytes.subarray(state.pos, state.pos + n); state.pos += n; return s; },
    fstr(): string {
      const length = this.i32();
      if (length === 0) return "";
      const utf16 = length < 0;
      const charCount = Math.abs(length);
      const byteLen = utf16 ? charCount * 2 : charCount;
      const slice = this.bytes(byteLen);
      if (utf16) {
        const s = utf16Decoder.decode(slice);
        const t = s.indexOf("\0");
        return t === -1 ? s : s.slice(0, t);
      }
      let t = slice.indexOf(0);
      if (t === -1) t = slice.length;
      return winDecoder.decode(slice.subarray(0, t));
    },
    arr<T>(readOne: () => T): T[] {
      const n = this.u32();
      if (n > 5_000_000) throw new Error("Implausible array length " + n);
      const out = new Array<T>(n);
      for (let i = 0; i < n; i++) out[i] = readOne();
      return out;
    },
  };
}

// ---------------------------------------------------------------------
// Bit-level reader, LSB-first.
// ---------------------------------------------------------------------
const f32Scratch = new DataView(new ArrayBuffer(4));

class BitReader {
  buf: Buffer;
  bitPos: number;
  endBit: number;
  constructor(buf: Buffer, start: number, end: number) {
    this.buf = buf;
    this.bitPos = start * 8;
    this.endBit = end * 8;
  }
  isEmpty() { return this.endBit - this.bitPos <= 0; }

  readBitsN(n: number): number | null {
    if (n === 0) return 0;
    if (this.bitPos + n > this.endBit) return null;
    let result = 0, bitIndex = 0, p = this.bitPos;
    while (bitIndex < n) {
      const byteIdx = p >>> 3;
      const bitInByte = p & 7;
      const take = Math.min(8 - bitInByte, n - bitIndex);
      const chunk = (this.buf[byteIdx] >>> bitInByte) & ((1 << take) - 1);
      result += chunk * Math.pow(2, bitIndex);
      bitIndex += take;
      p += take;
    }
    this.bitPos = p;
    return result;
  }
  readBitsBig(n: number): bigint | null {
    if (this.bitPos + n > this.endBit) return null;
    let result = BigInt(0), bitIndex = 0, p = this.bitPos;
    while (bitIndex < n) {
      const byteIdx = p >>> 3;
      const bitInByte = p & 7;
      const take = Math.min(8 - bitInByte, n - bitIndex);
      const chunk = (this.buf[byteIdx] >>> bitInByte) & ((1 << take) - 1);
      result += BigInt(chunk) << BigInt(bitIndex);
      bitIndex += take;
      p += take;
    }
    this.bitPos = p;
    return result;
  }
  readBit(): boolean | null { const v = this.readBitsN(1); return v === null ? null : v === 1; }
  readBitsMaxComputed(bitsN: number, max: number): number | null {
    const data = this.readBitsN(bitsN);
    if (data === null) return null;
    const up = data + Math.pow(2, bitsN);
    if (up >= max) return data;
    const extra = this.readBit();
    if (extra === null) return null;
    return extra ? up : data;
  }
  ifGet<T>(readFn: (b: BitReader) => T): T | null | undefined {
    const b = this.readBit();
    if (b === null) return undefined;
    if (!b) return null;
    return readFn(this);
  }
  readU8(): number | null { return this.readBitsN(8); }
  readU32(): number | null { return this.readBitsN(32); }
  readI32(): number | null { const v = this.readBitsN(32); return v === null ? null : v | 0; }
  readU64(): bigint | null { return this.readBitsBig(64); }
  readI64(): bigint | null { const v = this.readBitsBig(64); return v === null ? null : BigInt.asIntN(64, v); }
  readF32(): number | null {
    const v = this.readBitsN(32);
    if (v === null) return null;
    f32Scratch.setUint32(0, v >>> 0, true);
    return f32Scratch.getFloat32(0, true);
  }
  readBytes(n: number): Uint8Array | null {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const v = this.readBitsN(8);
      if (v === null) return null;
      out[i] = v;
    }
    return out;
  }
}

function bitWidth(input: number): number {
  if (input === 0) return 0;
  let n = 0;
  const x = BigInt(input);
  for (let i = 63; i >= 0; i--) {
    if ((x >> BigInt(i)) & BigInt(1)) { n = i + 1; break; }
  }
  return n;
}

// ---------------------------------------------------------------------
// Vector3i / Vector3f / Quaternion / Rotation
// ---------------------------------------------------------------------
function decodeVector3i(bits: BitReader, netVersion: number) {
  const maxSize = netVersion >= 7 ? 22 : 20;
  const sizeBits = bits.readBitsMaxComputed(4, maxSize);
  if (sizeBits === null) return null;
  const bias = Math.pow(2, sizeBits + 1);
  const bitLimit = sizeBits + 2;
  const dx = bits.readBitsN(bitLimit), dy = bits.readBitsN(bitLimit), dz = bits.readBitsN(bitLimit);
  if (dx === null || dy === null || dz === null) return null;
  return { x: dx - bias, y: dy - bias, z: dz - bias };
}
function decodeVector3f(bits: BitReader, netVersion: number) {
  const v = decodeVector3i(bits, netVersion);
  return v ? { x: v.x / 100, y: v.y / 100, z: v.z / 100 } : null;
}
function unpackQuat(val: number) {
  const maxValue = (1 << 18) - 1;
  const posRange = val / maxValue;
  return ((posRange - 0.5) * 2.0) * (1 / Math.SQRT2);
}
function decodeQuaternion(bits: BitReader) {
  const largest = bits.readBitsN(2);
  const a = unpackQuat(bits.readBitsN(18)!), b = unpackQuat(bits.readBitsN(18)!), c = unpackQuat(bits.readBitsN(18)!);
  const extra = Math.sqrt(Math.max(0, 1 - a * a - b * b - c * c));
  switch (largest) {
    case 0: return { x: extra, y: a, z: b, w: c };
    case 1: return { x: a, y: extra, z: b, w: c };
    case 2: return { x: a, y: b, z: extra, w: c };
    default: return { x: a, y: b, z: c, w: extra };
  }
}
function decodeQuaternionCompressed(bits: BitReader) {
  const f = () => { const res = bits.readBitsN(16)!; return (res - 32768) * (1 / 32767); };
  return { x: f(), y: f(), z: f(), w: 0 };
}
function decodeRotation(bits: BitReader) {
  const toI8 = (v: number) => (v << 24) >> 24;
  const hasYaw = bits.readBitsN(1);
  const yaw = hasYaw ? toI8(bits.readBitsN(8)!) : null;
  const hasPitch = bits.readBitsN(1);
  const pitch = hasPitch ? toI8(bits.readBitsN(8)!) : null;
  const hasRoll = bits.readBitsN(1);
  const roll = hasRoll ? toI8(bits.readBitsN(8)!) : null;
  return { yaw, pitch, roll };
}

// ---------------------------------------------------------------------
// SPAWN_STATS / PARENT_CLASSES / ATTRIBUTES tables
// (independently reconstructed from the public replay-format spec)
// ---------------------------------------------------------------------
const SPAWN_NONE = 0, SPAWN_LOCATION = 1, SPAWN_LOC_ROT = 2;
const SPAWN_STATS: [string, number][] = [
  ["Engine.Actor", SPAWN_LOCATION],
  ["Engine.ZoneInfo", SPAWN_NONE],
  ["TAGame.BreakOutActor_Platform_TA", SPAWN_NONE],
  ["TAGame.CrowdActor_TA", SPAWN_NONE],
  ["TAGame.CrowdManager_TA", SPAWN_NONE],
  ["TAGame.HauntedBallTrapTrigger_TA", SPAWN_NONE],
  ["TAGame.InMapScoreboard_TA", SPAWN_NONE],
  ["TAGame.PlayerStart_Platform_TA", SPAWN_NONE],
  ["TAGame.RBActor_TA", SPAWN_LOC_ROT],
  ["TAGame.VehiclePickup_Boost_TA", SPAWN_NONE],
  ["TAGame.KeepUpIndicator_TA", SPAWN_LOC_ROT],
];

const PARENT_CLASSES: Record<string, string> = {
  "Archetypes.Ball.Ball_Anniversary": "TAGame.Ball_TA", "Archetypes.Ball.Ball_BasketBall_Mutator": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_Basketball": "TAGame.Ball_TA", "Archetypes.Ball.Ball_BasketBall": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_Beachball": "TAGame.Ball_TA", "Archetypes.Ball.Ball_Breakout": "TAGame.Ball_Breakout_TA",
  "Archetypes.Ball.Ball_Default": "TAGame.Ball_TA", "Archetypes.Ball.Ball_Ekin": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_Fire_Obstacle": "TAGame.Ball_Fire_TA", "Archetypes.Ball.Ball_Fire": "TAGame.Ball_Fire_TA",
  "Archetypes.Ball.Ball_Football": "TAGame.Ball_TA", "Archetypes.Ball.Ball_God": "TAGame.Ball_God_TA",
  "Archetypes.Ball.Ball_Haunted": "TAGame.Ball_Haunted_TA", "Archetypes.Ball.ball_luminousairplane": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_PizzaPuck": "TAGame.Ball_TA", "Archetypes.Ball.Ball_Puck": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_RingSpawner": "TAGame.Ball_Spawner_TA", "Archetypes.Ball.Ball_Score": "TAGame.Ball_Breakout_TA",
  "Archetypes.Ball.Ball_Shoe": "TAGame.Ball_TA", "Archetypes.Ball.Ball_SpookyBalloon": "TAGame.Ball_TA",
  "Archetypes.Ball.Ball_Strike": "TAGame.Ball_TA", "Archetypes.Ball.Ball_Training": "TAGame.Ball_Tutorial_TA",
  "Archetypes.Ball.Ball_Trajectory": "TAGame.Ball_Trajectory_TA", "Archetypes.Ball.Ball_Tutorial": "TAGame.Ball_Tutorial_TA",
  "Archetypes.Ball.Ball_WorldCup": "TAGame.Ball_TA", "Archetypes.Ball.BallComponent_KeepUp": "TAGame.BallKeepUpComponent_TA",
  "Archetypes.Ball.CubeBall": "TAGame.Ball_TA", "Archetypes.Car.Car_Default": "TAGame.Car_TA",
  "Archetypes.Car.Car_PostGameLobby": "TAGame.Car_Freeplay_TA", "Archetypes.CarComponents.CarComponent_Boost": "TAGame.CarComponent_Boost_TA",
  "Archetypes.CarComponents.CarComponent_Dodge": "TAGame.CarComponent_Dodge_TA",
  "Archetypes.CarComponents.CarComponent_DoubleJump": "TAGame.CarComponent_DoubleJump_TA",
  "Archetypes.CarComponents.CarComponent_FlipCar": "TAGame.CarComponent_FlipCar_TA",
  "Archetypes.CarComponents.CarComponent_Jump": "TAGame.CarComponent_Jump_TA",
  "Archetypes.CarComponents.CarComponent_TerritoryDemolish": "TAGame.CarComponent_TerritoryDemolish_TA",
  "Archetypes.GameEvent.GameEvent_Basketball": "TAGame.GameEvent_Soccar_TA",
  "Archetypes.GameEvent.GameEvent_BasketballPrivate": "TAGame.GameEvent_SoccarPrivate_TA",
  "Archetypes.GameEvent.GameEvent_BasketballSplitscreen": "TAGame.GameEvent_SoccarSplitscreen_TA",
  "Archetypes.GameEvent.GameEvent_Breakout": "TAGame.GameEvent_Breakout_TA",
  "Archetypes.GameEvent.GameEvent_FTE_Part1_Prime": "TAGame.GameEvent_FTE_TA",
  "Archetypes.GameEvent.GameEvent_Hockey": "TAGame.GameEvent_Soccar_TA",
  "Archetypes.GameEvent.GameEvent_HockeyPrivate": "TAGame.GameEvent_SoccarPrivate_TA",
  "Archetypes.GameEvent.GameEvent_HockeySplitscreen": "TAGame.GameEvent_SoccarSplitscreen_TA",
  "Archetypes.GameEvent.GameEvent_Items": "TAGame.GameEvent_Soccar_TA",
  "Archetypes.GameEvent.GameEvent_Season:CarArchetype": "TAGame.Car_Season_TA",
  "Archetypes.GameEvent.GameEvent_Season": "TAGame.GameEvent_Season_TA", "Archetypes.GameEvent.GameEvent_Soccar": "TAGame.GameEvent_Soccar_TA",
  "Archetypes.GameEvent.GameEvent_SoccarLan": "TAGame.GameEvent_Soccar_TA",
  "Archetypes.GameEvent.GameEvent_SoccarPrivate": "TAGame.GameEvent_SoccarPrivate_TA",
  "Archetypes.GameEvent.GameEvent_SoccarSplitscreen": "TAGame.GameEvent_SoccarPrivate_TA",
  "Archetypes.GameEvent.GameEvent_Tutorial_Advanced": "TAGame.GameEvent_Tutorial_Advanced_TA",
  "Archetypes.GameEvent.GameEvent_Tutorial_Basic": "TAGame.GameEvent_Tutorial_Basic_TA",
  "Archetypes.GameEvent.GameEvent_Tutorial_FreePlay": "TAGame.GameEvent_Tutorial_FreePlay_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.Boost": "TAGame.CarComponent_Boost_KO_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.Dodge": "TAGame.CarComponent_Dodge_KO_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.DoubleJump": "TAGame.CarComponent_DoubleJump_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.Flip": "TAGame.CarComponent_FlipCar_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.Jump": "TAGame.CarComponent_Jump_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.StunlockArchetype": "TAGame.Stunlock_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype.Torque": "TAGame.CarComponent_Torque_TA",
  "Archetypes.KnockOut.GameEvent_Knockout:CarArchetype": "TAGame.Car_KnockOut_TA",
  "Archetypes.KnockOut.GameEvent_Knockout": "TAGame.GameEvent_KnockOut_TA", "Archetypes.Misc.KeepUpIndicator": "TAGame.KeepUpIndicator_TA",
  "Archetypes.Mutators.Mutator_Robin:AutoFlip": "TAGame.CarComponent_FlipCar_TA",
  "Archetypes.Mutators.Mutator_Robin:DoubleJump": "TAGame.CarComponent_DoubleJump_Robin_TA",
  "Archetypes.Mutators.Mutator_Robin:Jump": "TAGame.CarComponent_Jump_Robin_TA",
  "Archetypes.Mutators.SubRules.ItemsMode_RPS:DispenserArchetype.ItemPool.Obj_1": "TAGame.SpecialPickup_BallCarSpring_TA",
  "Archetypes.Mutators.SubRules.ItemsMode_RPS:DispenserArchetype.ItemPool.Obj_2": "TAGame.SpecialPickup_BallFreeze_TA",
  "Archetypes.Mutators.SubRules.ItemsMode_RPS:DispenserArchetype.ItemPool.Obj": "TAGame.SpecialPickup_BallCarSpring_TA",
  "Archetypes.SpecialPickups.BM.SpecialPickup_BallFreeze_BM": "TAGame.SpecialPickup_BallFreeze_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BallFreeze": "TAGame.SpecialPickup_BallFreeze_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BallGrapplingHook": "TAGame.SpecialPickup_GrapplingHook_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BallLasso": "TAGame.SpecialPickup_BallLasso_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BallSpring": "TAGame.SpecialPickup_BallCarSpring_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BallVelcro": "TAGame.SpecialPickup_BallVelcro_TA",
  "Archetypes.SpecialPickups.SpecialPickup_Batarang": "TAGame.SpecialPickup_Batarang_TA",
  "Archetypes.SpecialPickups.SpecialPickup_BoostOverride": "TAGame.SpecialPickup_BoostOverride_TA",
  "Archetypes.SpecialPickups.SpecialPickup_CarSpring": "TAGame.SpecialPickup_BallCarSpring_TA",
  "Archetypes.SpecialPickups.SpecialPickup_Football": "TAGame.SpecialPickup_Football_TA",
  "Archetypes.SpecialPickups.SpecialPickup_GravityWell": "TAGame.SpecialPickup_BallGravity_TA",
  "Archetypes.SpecialPickups.SpecialPickup_HauntedBallBeam": "TAGame.SpecialPickup_HauntedBallBeam_TA",
  "Archetypes.SpecialPickups.SpecialPickup_Rugby": "TAGame.SpecialPickup_Rugby_TA",
  "Archetypes.SpecialPickups.SpecialPickup_RugbyLightDark": "TAGame.SpecialPickup_Rugby_TA",
  "Archetypes.SpecialPickups.SpecialPickup_StrongHit": "TAGame.SpecialPickup_HitForce_TA",
  "Archetypes.SpecialPickups.SpecialPickup_Swapper": "TAGame.SpecialPickup_Swapper_TA",
  "Archetypes.SpecialPickups.SpecialPickup_Tornado": "TAGame.SpecialPickup_Tornado_TA",
  "Archetypes.Teams.Team0": "TAGame.Team_Soccar_TA", "Archetypes.Teams.Team1": "TAGame.Team_Soccar_TA",
  "Archetypes.Teams.TeamWhite0": "TAGame.Team_Freeplay_TA", "Archetypes.Teams.TeamWhite1": "TAGame.Team_Freeplay_TA",
  "Archetypes.Tutorial.Cannon": "TAGame.Cannon_TA", "Engine.Actor": "Core.Object",
  "Engine.GameReplicationInfo": "Engine.ReplicationInfo", "Engine.Info": "Engine.Actor",
  "Engine.NavigationPoint": "Engine.Actor", "Engine.Pawn": "Engine.Actor",
  "Engine.PlayerReplicationInfo": "Engine.ReplicationInfo", "Engine.PlayerStart": "Engine.NavigationPoint",
  "Engine.ReplicatedActor_ORS": "Engine.Actor", "Engine.ReplicationInfo": "Engine.Info",
  "Engine.TeamInfo": "Engine.Info", "Engine.WorldInfo": "Engine.ZoneInfo", "Engine.ZoneInfo": "Engine.Info",
  "GameInfo_Basketball.GameInfo.GameInfo_Basketball:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_Basketball.GameInfo.GameInfo_Basketball:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Breakout.GameInfo.GameInfo_Breakout:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_FootBall.GameInfo.GameInfo_FootBall:Archetype": "TAGame.GameEvent_Football_TA",
  "GameInfo_FootBall.GameInfo.GameInfo_FootBall:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_FTE.GameInfo.GameInfo_FTE:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "gameinfo_godball.GameInfo.gameinfo_godball:Archetype": "TAGame.GameEvent_GodBall_TA",
  "GameInfo_GodBall.GameInfo.GameInfo_GodBall:Archetype": "TAGame.GameEvent_GodBall_TA",
  "gameinfo_godball.GameInfo.gameinfo_godball:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_GodBall.GameInfo.GameInfo_GodBall:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_HeatseekerTerritory.GameInfo.GameInfo_HeatseekerTerritory:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_HeatseekerTerritory.GameInfo.GameInfo_HeatseekerTerritory:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "Gameinfo_Hockey.GameInfo.Gameinfo_Hockey:Archetype": "TAGame.GameEvent_Soccar_TA",
  "Gameinfo_Hockey.GameInfo.Gameinfo_Hockey:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Hops.GameInfo.GameInfo_Hops:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_Hops.GameInfo.GameInfo_Hops:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Items.GameInfo.GameInfo_Items:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_KnockOut.KnockOut.GameInfo_KnockOut:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_AprilFool.GameInfo.GameInfo_LTM_AprilFool:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_AprilFool.GameInfo.GameInfo_LTM_AprilFool:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_BeachBall.GameInfo.GameInfo_LTM_BeachBall:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_BeachBall.GameInfo.GameInfo_LTM_BeachBall:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_DropshotRumble.GameInfo.GameInfo_LTM_DropshotRumble:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_DropshotRumble.GameInfo.GameInfo_LTM_DropshotRumble:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_SpeedDemon.GameInfo.GameInfo_LTM_SpeedDemon:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_SpeedDemon.GameInfo.GameInfo_LTM_SpeedDemon:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_SpikeRush.GameInfo.GameInfo_LTM_SpikeRush:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_SpikeRush.GameInfo.GameInfo_LTM_SpikeRush:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_LTM_SuperCube.GameInfo.GameInfo_LTM_SuperCube:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_LTM_SuperCube.GameInfo.GameInfo_LTM_SuperCube:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_MagnusFutball.GameInfo.GameInfo_MagnusFutball:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_MagnusFutball.GameInfo.GameInfo_MagnusFutball:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Possession.GameInfo.GameInfo_Possession:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_Possession.GameInfo.GameInfo_Possession:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Season.GameInfo.GameInfo_Season:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_SnowDayTerritory.GameInfo.GameInfo_SnowDayTerritory:Archetype": "TAGame.GameEvent_Territory_TA",
  "GameInfo_SnowDayTerritory.GameInfo.GameInfo_SnowDayTerritory:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Soccar.GameInfo.GameInfo_Soccar:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_SpikeDrop.GameInfo.GameInfo_SpikeDrop:Archetype": "TAGame.GameEvent_Soccar_TA",
  "GameInfo_SpikeDrop.GameInfo.GameInfo_SpikeDrop:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Territory.GameInfo.GameInfo_Territory:Archetype": "TAGame.GameEvent_Territory_TA",
  "GameInfo_Territory.GameInfo.GameInfo_Territory:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "GameInfo_Tutorial.GameEvent.GameEvent_Tutorial_Aerial": "TAGame.GameEvent_Training_Aerial_TA",
  "GameInfo_Tutorial.GameEvent.GameEvent_Tutorial_Goalie": "TAGame.GameEvent_Training_Goalie_TA",
  "GameInfo_Tutorial.GameEvent.GameEvent_Tutorial_Striker": "TAGame.GameEvent_Training_Striker_TA",
  "GameInfo_Tutorial.GameInfo.GameInfo_Tutorial:GameReplicationInfoArchetype": "TAGame.GRI_TA",
  "Haunted_TrainStation_P.TheWorld:PersistentLevel.HauntedBallTrapTrigger_TA_0": "TAGame.HauntedBallTrapTrigger_TA",
  "Haunted_TrainStation_P.TheWorld:PersistentLevel.HauntedBallTrapTrigger_TA_1": "TAGame.HauntedBallTrapTrigger_TA",
  "Mutators.Mutators.Mutators.FreePlay:CarArchetype": "TAGame.Car_Freeplay_TA",
  "Mutators.Mutators.Mutators.OnlineFreeplay:CarArchetype": "TAGame.Car_Freeplay_TA",
  "ProjectX.Default__NetModeReplicator_X": "ProjectX.NetModeReplicator_X", "ProjectX.GRI_X": "Engine.GameReplicationInfo",
  "ProjectX.NetModeReplicator_X": "Engine.ReplicationInfo", "ProjectX.Pawn_X": "Engine.Pawn",
  "ProjectX.PRI_X": "Engine.PlayerReplicationInfo", "TAGame.Ball_Breakout_TA": "TAGame.Ball_TA",
  "TAGame.Ball_Fire_TA": "TAGame.Ball_God_TA", "TAGame.Ball_God_TA": "TAGame.Ball_TA",
  "TAGame.Ball_Haunted_TA": "TAGame.Ball_TA", "TAGame.Ball_Spawner_TA": "Engine.Actor",
  "TAGame.Ball_TA": "TAGame.RBActor_TA", "TAGame.Ball_Trajectory_TA": "TAGame.Ball_TA",
  "TAGame.Ball_Tutorial_TA": "TAGame.Ball_TA", "TAGame.BallKeepUpComponent_TA": "Engine.ReplicatedActor_ORS",
  "TAGame.BreakOutActor_Platform_TA": "Engine.Actor", "TAGame.CameraSettingsActor_TA": "Engine.ReplicationInfo",
  "TAGame.Cannon_TA": "Engine.Actor", "TAGame.Car_Freeplay_TA": "TAGame.Car_TA", "TAGame.Car_KnockOut_TA": "TAGame.Car_TA",
  "TAGame.Car_Season_TA": "TAGame.Car_TA", "TAGame.Car_TA": "TAGame.Vehicle_TA",
  "TAGame.CarComponent_AirActivate_TA": "TAGame.CarComponent_TA", "TAGame.CarComponent_Boost_KO_TA": "TAGame.CarComponent_Boost_TA",
  "TAGame.CarComponent_Boost_TA": "TAGame.CarComponent_AirActivate_TA", "TAGame.CarComponent_Dodge_KO_TA": "TAGame.CarComponent_Dodge_TA",
  "TAGame.CarComponent_Dodge_TA": "TAGame.CarComponent_AirActivate_TA",
  "TAGame.CarComponent_DoubleJump_KO_TA": "TAGame.CarComponent_DoubleJump_TA",
  "TAGame.CarComponent_DoubleJump_Robin_TA": "TAGame.CarComponent_DoubleJump_TA",
  "TAGame.CarComponent_DoubleJump_TA": "TAGame.CarComponent_AirActivate_TA", "TAGame.CarComponent_FlipCar_TA": "TAGame.CarComponent_TA",
  "TAGame.CarComponent_Jump_Robin_TA": "TAGame.CarComponent_Jump_TA", "TAGame.CarComponent_Jump_TA": "TAGame.CarComponent_TA",
  "TAGame.CarComponent_TA": "Engine.ReplicationInfo", "TAGame.CarComponent_TerritoryDemolish_TA": "TAGame.CarComponent_TA",
  "TAGame.CarComponent_Torque_TA": "TAGame.CarComponent_TA", "TAGame.CrowdActor_TA": "Engine.ReplicationInfo",
  "TAGame.CrowdManager_TA": "Engine.ReplicationInfo", "TAGame.Default__CameraSettingsActor_TA": "TAGame.CameraSettingsActor_TA",
  "TAGame.Default__Car_TA": "TAGame.Car_TA", "TAGame.Default__FreeplayCommands_TA": "TAGame.FreeplayCommands_TA",
  "TAGame.Default__MaxTimeWarningData_TA": "TAGame.MaxTimeWarningData_TA", "TAGame.Default__PickupTimer_TA": "TAGame.PickupTimer_TA",
  "TAGame.Default__PRI_Breakout_TA": "TAGame.PRI_Breakout_TA", "TAGame.Default__PRI_KnockOut_TA": "TAGame.PRI_KnockOut_TA",
  "TAGame.Default__PRI_Possession_TA": "TAGame.PRI_Possession_TA", "TAGame.Default__PRI_TA": "TAGame.PRI_TA",
  "TAGame.Default__RumblePickups_TA": "TAGame.RumblePickups_TA",
  "TAGame.Default__TrackerWallDynamicMeshActor_TA": "TAGame.TrackerWallDynamicMeshActor_TA",
  "TAGame.Default__ViralItemActor_TA": "TAGame.ViralItemActor_TA", "TAGame.Default__VoteActor_TA": "TAGame.VoteActor_TA",
  "TAGame.DynamicMeshActor_TA": "Engine.Actor", "TAGame.FreeplayCommands_TA": "Engine.Actor",
  "TAGame.GameEvent_Breakout_TA": "TAGame.GameEvent_Soccar_TA", "TAGame.GameEvent_Football_TA": "TAGame.GameEvent_Soccar_TA",
  "TAGame.GameEvent_FTE_TA": "TAGame.GameEvent_Soccar_TA", "TAGame.GameEvent_GodBall_TA": "TAGame.GameEvent_Soccar_TA",
  "TAGame.GameEvent_KnockOut_TA": "TAGame.GameEvent_Soccar_TA", "TAGame.GameEvent_Season_TA": "TAGame.GameEvent_Soccar_TA",
  "TAGame.GameEvent_Soccar_TA": "TAGame.GameEvent_Team_TA", "TAGame.GameEvent_SoccarPrivate_TA": "TAGame.GameEvent_Soccar_TA",
  "TAGame.GameEvent_SoccarSplitscreen_TA": "TAGame.GameEvent_SoccarPrivate_TA", "TAGame.GameEvent_TA": "Engine.ReplicationInfo",
  "TAGame.GameEvent_Team_TA": "TAGame.GameEvent_TA", "TAGame.GameEvent_Territory_TA": "TAGame.GameEvent_Soccar_TA",
  "TAGame.GameEvent_Training_Aerial_TA": "TAGame.GameEvent_Training_TA", "TAGame.GameEvent_Training_Goalie_TA": "TAGame.GameEvent_Training_TA",
  "TAGame.GameEvent_Training_Striker_TA": "TAGame.GameEvent_Training_TA", "TAGame.GameEvent_Training_TA": "TAGame.GameEvent_Tutorial_TA",
  "TAGame.GameEvent_Tutorial_Advanced_TA": "TAGame.GameEvent_Tutorial_Basic_TA",
  "TAGame.GameEvent_Tutorial_Basic_TA": "TAGame.GameEvent_Tutorial_TA", "TAGame.GameEvent_Tutorial_FreePlay_TA": "TAGame.GameEvent_Tutorial_TA",
  "TAGame.GameEvent_Tutorial_TA": "TAGame.GameEvent_Soccar_TA", "TAGame.GRI_TA": "ProjectX.GRI_X",
  "TAGame.HauntedBallTrapTrigger_TA": "TAGame.DynamicMeshActor_TA", "TAGame.InMapScoreboard_TA": "Engine.Actor",
  "TAGame.KeepUpIndicator_TA": "Engine.Actor", "TAGame.MaxTimeWarningData_TA": "Engine.ReplicatedActor_ORS",
  "TAGame.PickupTimer_TA": "TAGame.CarComponent_TA", "TAGame.PlayerStart_Platform_TA": "Engine.Actor",
  "TAGame.PRI_Breakout_TA": "TAGame.PRI_TA", "TAGame.PRI_KnockOut_TA": "TAGame.PRI_TA", "TAGame.PRI_Possession_TA": "TAGame.PRI_TA",
  "TAGame.PRI_TA": "ProjectX.PRI_X", "TAGame.ProductAttribute_Blueprint_TA": "TAGame.ProductAttribute_TA",
  "TAGame.ProductAttribute_BlueprintCost_TA": "TAGame.ProductAttribute_TA", "TAGame.ProductAttribute_Certified_TA": "TAGame.ProductAttribute_TA",
  "TAGame.ProductAttribute_NoNotify_TA": "TAGame.ProductAttribute_TA", "TAGame.ProductAttribute_Painted_TA": "TAGame.ProductAttribute_TA",
  "TAGame.ProductAttribute_Quality_TA": "TAGame.ProductAttribute_TA", "TAGame.ProductAttribute_SpecialEdition_TA": "TAGame.ProductAttribute_TA",
  "TAGame.ProductAttribute_TA": "Core.Object", "TAGame.ProductAttribute_TeamEdition_TA": "TAGame.ProductAttribute_TA",
  "TAGame.ProductAttribute_TitleID_TA": "TAGame.ProductAttribute_TA", "TAGame.ProductAttribute_UserColor_TA": "TAGame.ProductAttribute_TA",
  "TAGame.RBActor_TA": "ProjectX.Pawn_X", "TAGame.Replay_Soccar_TA": "TAGame.Replay_TA", "TAGame.Replay_TA": "Core.Object",
  "TAGame.RumblePickups_TA": "Engine.Actor", "TAGame.SaveData_GameEditor_Training_TA": "Core.Object",
  "TAGame.SpecialPickup_BallCarSpring_TA": "TAGame.SpecialPickup_Spring_TA", "TAGame.SpecialPickup_BallFreeze_TA": "TAGame.SpecialPickup_Targeted_TA",
  "TAGame.SpecialPickup_BallGravity_TA": "TAGame.SpecialPickup_TA", "TAGame.SpecialPickup_BallLasso_TA": "TAGame.SpecialPickup_Spring_TA",
  "TAGame.SpecialPickup_BallVelcro_TA": "TAGame.SpecialPickup_TA", "TAGame.SpecialPickup_Batarang_TA": "TAGame.SpecialPickup_BallLasso_TA",
  "TAGame.SpecialPickup_BoostOverride_TA": "TAGame.SpecialPickup_Targeted_TA", "TAGame.SpecialPickup_Football_TA": "TAGame.SpecialPickup_TA",
  "TAGame.SpecialPickup_GrapplingHook_TA": "TAGame.SpecialPickup_Targeted_TA", "TAGame.SpecialPickup_HauntedBallBeam_TA": "TAGame.SpecialPickup_BallGravity_TA",
  "TAGame.SpecialPickup_HitForce_TA": "TAGame.SpecialPickup_TA", "TAGame.SpecialPickup_Rugby_TA": "TAGame.SpecialPickup_TA",
  "TAGame.SpecialPickup_Spring_TA": "TAGame.SpecialPickup_Targeted_TA", "TAGame.SpecialPickup_Swapper_TA": "TAGame.SpecialPickup_Targeted_TA",
  "TAGame.SpecialPickup_TA": "TAGame.CarComponent_TA", "TAGame.SpecialPickup_Targeted_TA": "TAGame.SpecialPickup_TA",
  "TAGame.SpecialPickup_Tornado_TA": "TAGame.SpecialPickup_TA", "TAGame.Stunlock_TA": "Engine.Actor",
  "TAGame.Team_Freeplay_TA": "TAGame.Team_Soccar_TA", "TAGame.Team_Soccar_TA": "TAGame.Team_TA", "TAGame.Team_TA": "Engine.TeamInfo",
  "TAGame.TrackerWallDynamicMeshActor_TA": "TAGame.DynamicMeshActor_TA", "TAGame.TrainingEditorData_TA": "Core.Object",
  "TAGame.Vehicle_TA": "TAGame.RBActor_TA",
  "TAGame.VehiclePickup_Boost_TA": "TAGame.VehiclePickup_TA", "TAGame.VehiclePickup_TA": "Engine.ReplicationInfo",
  "TAGame.ViralItemActor_TA": "Engine.Actor",
  "TheWorld:PersistentLevel.BreakOutActor_Platform_TA": "TAGame.BreakOutActor_Platform_TA",
  "TheWorld:PersistentLevel.CrowdActor_TA": "TAGame.CrowdActor_TA",
  "TheWorld:PersistentLevel.CrowdManager_TA": "TAGame.CrowdManager_TA",
  "TheWorld:PersistentLevel.InMapScoreboard_TA": "TAGame.InMapScoreboard_TA",
  "TheWorld:PersistentLevel.PlayerStart_Platform_TA": "TAGame.PlayerStart_Platform_TA",
  "TheWorld:PersistentLevel.VehiclePickup_Boost_TA": "TAGame.VehiclePickup_Boost_TA",
};

const ATTRIBUTES: Record<string, string> = {
  "Engine.Actor:bBlockActors": "Boolean", "Engine.Actor:bCollideActors": "Boolean", "Engine.Actor:bCollideWorld": "Boolean",
  "Engine.Actor:bHidden": "Boolean", "Engine.Actor:bNetOwner": "Boolean", "Engine.Actor:bTearOff": "Boolean",
  "Engine.Actor:DrawScale": "Float", "Engine.Actor:RemoteRole": "Enum", "Engine.Actor:Role": "Enum", "Engine.Actor:Rotation": "RotationTag",
  "Engine.GameReplicationInfo:bMatchIsOver": "Boolean", "Engine.GameReplicationInfo:GameClass": "ActiveActor",
  "Engine.GameReplicationInfo:ServerName": "String", "Engine.Pawn:bFastAttachedMove": "Boolean", "Engine.Pawn:bIsCrouched": "Boolean",
  "Engine.Pawn:bUsedByMatinee": "Boolean", "Engine.Pawn:HealthMax": "Int", "Engine.Pawn:PlayerReplicationInfo": "ActiveActor",
  "Engine.Pawn:RemoteViewPitch": "Byte", "Engine.PlayerReplicationInfo:bAdmin": "Boolean", "Engine.PlayerReplicationInfo:bBot": "Boolean",
  "Engine.PlayerReplicationInfo:bIsSpectator": "Boolean", "Engine.PlayerReplicationInfo:bReadyToPlay": "Boolean",
  "Engine.PlayerReplicationInfo:bTimedOut": "Boolean", "Engine.PlayerReplicationInfo:bWaitingPlayer": "Boolean",
  "Engine.PlayerReplicationInfo:Ping": "Byte", "Engine.PlayerReplicationInfo:PlayerID": "Int",
  "Engine.PlayerReplicationInfo:PlayerName": "String", "Engine.PlayerReplicationInfo:RemoteUserData": "String",
  "Engine.PlayerReplicationInfo:Score": "Int", "Engine.PlayerReplicationInfo:Team": "ActiveActor",
  "Engine.PlayerReplicationInfo:UniqueId": "UniqueId", "Engine.ReplicatedActor_ORS:ReplicatedOwner": "ActiveActor",
  "Engine.TeamInfo:Score": "Int", "ProjectX.GRI_X:bGameStarted": "Boolean", "ProjectX.GRI_X:GameServerID": "QWordString",
  "ProjectX.GRI_X:MatchGuid": "String", "ProjectX.GRI_X:MatchGUID": "String", "ProjectX.GRI_X:ReplicatedGameMutatorIndex": "Int",
  "ProjectX.GRI_X:ReplicatedGamePlaylist": "Int", "ProjectX.GRI_X:ReplicatedServerRegion": "String", "ProjectX.GRI_X:Reservations": "Reservation",
  "TAGame.Ball_Breakout_TA:AppliedDamage": "AppliedDamage", "TAGame.Ball_Breakout_TA:DamageIndex": "Int",
  "TAGame.Ball_Breakout_TA:LastTeamTouch": "Byte", "TAGame.Ball_Fire_TA:TeamNumChangeTimestamp": "Float",
  "TAGame.Ball_God_TA:TargetSpeed": "Float", "TAGame.Ball_Haunted_TA:bIsBallBeamed": "Boolean",
  "TAGame.Ball_Haunted_TA:DeactivatedGoalIndex": "Byte", "TAGame.Ball_Haunted_TA:LastTeamTouch": "Byte",
  "TAGame.Ball_Haunted_TA:ReplicatedBeamBrokenValue": "Byte", "TAGame.Ball_Haunted_TA:TotalActiveBeams": "Byte",
  "TAGame.Ball_Spawner_TA:SpawnDelaySeconds": "Float", "TAGame.Ball_Spawner_TA:SpawnedBall": "ActiveActor",
  "TAGame.Ball_TA:AdditionalCarGroundBounceScaleXY": "Float", "TAGame.Ball_TA:AdditionalCarGroundBounceScaleZ": "Float",
  "TAGame.Ball_TA:AirResistance": "Location", "TAGame.Ball_TA:BallHitSpinScale": "Float", "TAGame.Ball_TA:bPossessionEnabled": "Boolean",
  "TAGame.Ball_TA:bWarnBallReset": "Boolean", "TAGame.Ball_TA:GameBallIndex": "Int", "TAGame.Ball_TA:GameEvent": "ActiveActor",
  "TAGame.Ball_TA:HitTeamNum": "Byte", "TAGame.Ball_TA:MagnusMinSpeed": "Float", "TAGame.Ball_TA:ReplicatedAddedCarBounceScale": "Float",
  "TAGame.Ball_TA:ReplicatedBallGravityScale": "Float", "TAGame.Ball_TA:ReplicatedBallMaxLinearSpeedScale": "Float",
  "TAGame.Ball_TA:ReplicatedBallScale": "Float", "TAGame.Ball_TA:ReplicatedExplosionData": "Explosion",
  "TAGame.Ball_TA:ReplicatedExplosionDataExtended": "ExtendedExplosion", "TAGame.Ball_TA:ReplicatedPhysMatOverride": "ActiveActor",
  "TAGame.Ball_TA:ReplicatedWorldBounceScale": "Float", "TAGame.BallKeepUpComponent_TA:BallOwner": "ActiveActor",
  "TAGame.BallKeepUpComponent_TA:KeepUpState": "Byte", "TAGame.BallKeepUpComponent_TA:Score": "Int",
  "TAGame.BreakOutActor_Platform_TA:DamageState": "DamageState", "TAGame.CameraSettingsActor_TA:bMouseCameraToggleEnabled": "Boolean",
  "TAGame.CameraSettingsActor_TA:bUsingBehindView": "Boolean", "TAGame.CameraSettingsActor_TA:bUsingSecondaryCamera": "Boolean",
  "TAGame.CameraSettingsActor_TA:bUsingSwivel": "Boolean", "TAGame.CameraSettingsActor_TA:CameraPitch": "Byte",
  "TAGame.CameraSettingsActor_TA:CameraYaw": "Byte", "TAGame.CameraSettingsActor_TA:PRI": "ActiveActor",
  "TAGame.CameraSettingsActor_TA:ProfileSettings": "CamSettings", "TAGame.Cannon_TA:FireCount": "Byte", "TAGame.Cannon_TA:Pitch": "Float",
  "TAGame.Car_KnockOut_TA:ReplicatedImpulse": "Impulse", "TAGame.Car_KnockOut_TA:ReplicatedStateChanged": "Byte",
  "TAGame.Car_KnockOut_TA:ReplicatedStateName": "Int", "TAGame.Car_KnockOut_TA:UsedAttackComponent": "ActiveActor",
  "TAGame.Car_TA:AddedBallForceMultiplier": "Float", "TAGame.Car_TA:AddedCarForceMultiplier": "Float",
  "TAGame.Car_TA:AttachedPickup": "ActiveActor", "TAGame.Car_TA:bUnlimitedJumps": "Boolean", "TAGame.Car_TA:bUnlimitedTimeForDodge": "Boolean",
  "TAGame.Car_TA:ClubColors": "ClubColors", "TAGame.Car_TA:DodgesRefreshedCounter": "Int",
  "TAGame.Car_TA:ReplicatedCarMaxLinearSpeedScale": "Float", "TAGame.Car_TA:ReplicatedCarScale": "Float",
  "TAGame.Car_TA:ReplicatedDemolish_CustomFX": "DemolishFx", "TAGame.Car_TA:ReplicatedDemolish": "Demolish",
  "TAGame.Car_TA:ReplicatedDemolishExtended": "DemolishExtended", "TAGame.Car_TA:ReplicatedDemolishGoalExplosion": "DemolishFx",
  "TAGame.Car_TA:RumblePickups": "ActiveActor", "TAGame.Car_TA:TeamPaint": "TeamPaint",
  "TAGame.CarComponent_AirActivate_TA:AirActivateCount": "Int", "TAGame.CarComponent_Boost_TA:bNoBoost": "Boolean",
  "TAGame.CarComponent_Boost_TA:BoostModifier": "Float", "TAGame.CarComponent_Boost_TA:BoostRestriction": "Byte",
  "TAGame.CarComponent_Boost_TA:bRechargeGroundOnly": "Boolean", "TAGame.CarComponent_Boost_TA:bUnlimitedBoost": "Boolean",
  "TAGame.CarComponent_Boost_TA:RechargeDelay": "Float", "TAGame.CarComponent_Boost_TA:RechargeRate": "Float",
  "TAGame.CarComponent_Boost_TA:ReplicatedBoost": "ReplicatedBoost", "TAGame.CarComponent_Boost_TA:ReplicatedBoostAmount": "Byte",
  "TAGame.CarComponent_Boost_TA:UnlimitedBoostRefCount": "Int", "TAGame.CarComponent_Dodge_KO_TA:DodgeRotationCompressed": "Int",
  "TAGame.CarComponent_Dodge_TA:DodgeImpulse": "Location", "TAGame.CarComponent_Dodge_TA:DodgeTorque": "Location",
  "TAGame.CarComponent_DoubleJump_TA:DoubleJumpImpulse": "Location", "TAGame.CarComponent_FlipCar_TA:bFlipRight": "Boolean",
  "TAGame.CarComponent_FlipCar_TA:FlipCarTime": "Float", "TAGame.CarComponent_TA:ReplicatedActive": "Byte",
  "TAGame.CarComponent_TA:ReplicatedActivityTime": "Float", "TAGame.CarComponent_TA:Vehicle": "ActiveActor",
  "TAGame.CarComponent_Torque_TA:ReplicatedTorqueInput": "Int", "TAGame.CarComponent_Torque_TA:TorqueScale": "Float",
  "TAGame.CrowdActor_TA:GameEvent": "ActiveActor", "TAGame.CrowdActor_TA:ModifiedNoise": "Float",
  "TAGame.CrowdActor_TA:ReplicatedCountDownNumber": "Int", "TAGame.CrowdActor_TA:ReplicatedOneShotSound": "ActiveActor",
  "TAGame.CrowdActor_TA:ReplicatedRoundCountDownNumber": "Int", "TAGame.CrowdManager_TA:GameEvent": "ActiveActor",
  "TAGame.CrowdManager_TA:ReplicatedGlobalOneShotSound": "ActiveActor", "TAGame.GameEvent_Soccar_TA:bAllowHonorDuels": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bBallHasBeenHit": "Boolean", "TAGame.GameEvent_Soccar_TA:bClubMatch": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bDisableCrowdSound": "Boolean", "TAGame.GameEvent_Soccar_TA:bFullClubMatch": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bFullMatchWinnerDecided": "Boolean", "TAGame.GameEvent_Soccar_TA:bGoalsEnabled": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bMatchCreatorAdminEnabled": "Boolean", "TAGame.GameEvent_Soccar_TA:bMatchEnded": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bNoContest": "Boolean", "TAGame.GameEvent_Soccar_TA:bOverTime": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bReadyToStartGame": "Boolean", "TAGame.GameEvent_Soccar_TA:bShouldSpawnGoalIndicators": "Boolean",
  "TAGame.GameEvent_Soccar_TA:bShowIntroScene": "Boolean", "TAGame.GameEvent_Soccar_TA:bUnlimitedTime": "Boolean",
  "TAGame.GameEvent_Soccar_TA:GameTime": "Int", "TAGame.GameEvent_Soccar_TA:GameWinner": "ActiveActor",
  "TAGame.GameEvent_Soccar_TA:MatchWinner": "ActiveActor", "TAGame.GameEvent_Soccar_TA:MaxScore": "Int",
  "TAGame.GameEvent_Soccar_TA:MVP": "ActiveActor", "TAGame.GameEvent_Soccar_TA:ReplicatedMusicStinger": "MusicStinger",
  "TAGame.GameEvent_Soccar_TA:ReplicatedScoredOnTeam": "Byte", "TAGame.GameEvent_Soccar_TA:ReplicatedServerPerformanceState": "Byte",
  "TAGame.GameEvent_Soccar_TA:ReplicatedStatEvent": "StatEvent", "TAGame.GameEvent_Soccar_TA:RoundNum": "Int",
  "TAGame.GameEvent_Soccar_TA:SecondsRemaining": "Int", "TAGame.GameEvent_Soccar_TA:SeriesLength": "Int",
  "TAGame.GameEvent_Soccar_TA:SubRulesArchetype": "ActiveActor", "TAGame.GameEvent_Soccar_TA:TotalGameBalls": "Int",
  "TAGame.GameEvent_SoccarPrivate_TA:MatchSettings": "PrivateMatchSettings", "TAGame.GameEvent_TA:bAllowReadyUp": "Boolean",
  "TAGame.GameEvent_TA:bAlwaysShowMatchTypeLabel": "Boolean", "TAGame.GameEvent_TA:bCanVoteToForfeit": "Boolean",
  "TAGame.GameEvent_TA:bHasLeaveMatchPenalty": "Boolean", "TAGame.GameEvent_TA:bIsBotMatch": "Boolean", "TAGame.GameEvent_TA:BotSkill": "Int",
  "TAGame.GameEvent_TA:DemoFXOverride": "ActiveActor", "TAGame.GameEvent_TA:GameMode": "GameMode",
  "TAGame.GameEvent_TA:MatchStartEpoch": "Int64", "TAGame.GameEvent_TA:MatchTypeClass": "ActiveActor",
  "TAGame.GameEvent_TA:ReplicatedGameStateTimeRemaining": "Int", "TAGame.GameEvent_TA:ReplicatedRoundCountDownNumber": "Int",
  "TAGame.GameEvent_TA:ReplicatedStateIndex": "Byte", "TAGame.GameEvent_TA:ReplicatedStateName": "Int",
  "TAGame.GameEvent_TA:RichPresenceString": "String", "TAGame.GameEvent_Team_TA:bDisableMutingOtherTeam": "Boolean",
  "TAGame.GameEvent_Team_TA:bDisableQuickChat": "Boolean", "TAGame.GameEvent_Team_TA:bForfeit": "Boolean",
  "TAGame.GameEvent_Team_TA:MaxTeamSize": "Int", "TAGame.GRI_TA:bAllowTargetFind": "Boolean", "TAGame.GRI_TA:LanMatchGUID": "String",
  "TAGame.GRI_TA:NewDedicatedServerIP": "String", "TAGame.KeepUpIndicator_TA:ComponentOwner": "ActiveActor",
  "TAGame.MaxTimeWarningData_TA:EndGameEpochTime": "Int64", "TAGame.MaxTimeWarningData_TA:EndGameWarningEpochTime": "Int64",
  "TAGame.PickupTimer_TA:MaxTimeTillItem": "Int", "TAGame.PickupTimer_TA:TimeTillItem": "Int",
  "TAGame.PlayerStart_Platform_TA:bActive": "Boolean", "TAGame.PRI_KnockOut_TA:bIsActiveMVP": "Boolean",
  "TAGame.PRI_KnockOut_TA:bIsEliminated": "Boolean", "TAGame.PRI_KnockOut_TA:Blocks": "Int", "TAGame.PRI_KnockOut_TA:DamageCaused": "Int",
  "TAGame.PRI_KnockOut_TA:EliminationOrder": "Int", "TAGame.PRI_KnockOut_TA:Grabs": "Int", "TAGame.PRI_KnockOut_TA:Hits": "Int",
  "TAGame.PRI_KnockOut_TA:KnockoutDeaths": "Int", "TAGame.PRI_KnockOut_TA:Knockouts": "Int", "TAGame.PRI_TA:AnonymizedName": "String",
  "TAGame.PRI_TA:bAnonymizeToOpponents": "Boolean", "TAGame.PRI_TA:bAnonymizeToTeammates": "Boolean", "TAGame.PRI_TA:bIdleBanned": "Boolean",
  "TAGame.PRI_TA:bIsDistracted": "Boolean", "TAGame.PRI_TA:bIsInSplitScreen": "Boolean", "TAGame.PRI_TA:bMatchMVP": "Boolean",
  "TAGame.PRI_TA:bOnlineLoadoutSet": "Boolean", "TAGame.PRI_TA:bOnlineLoadoutsSet": "Boolean", "TAGame.PRI_TA:BotBannerProductID": "Int",
  "TAGame.PRI_TA:BotProductName": "Int", "TAGame.PRI_TA:bReady": "Boolean", "TAGame.PRI_TA:bReceivedAnonymizationSettings": "Boolean",
  "TAGame.PRI_TA:bUsingBehindView": "Boolean", "TAGame.PRI_TA:bUsingItems": "Boolean", "TAGame.PRI_TA:bUsingSecondaryCamera": "Boolean",
  "TAGame.PRI_TA:CameraPitch": "Byte", "TAGame.PRI_TA:CameraSettings": "CamSettings", "TAGame.PRI_TA:CameraYaw": "Byte",
  "TAGame.PRI_TA:CarDemolitions": "Int", "TAGame.PRI_TA:ClientLoadout": "Loadout", "TAGame.PRI_TA:ClientLoadoutOnline": "LoadoutOnline",
  "TAGame.PRI_TA:ClientLoadouts": "TeamLoadout", "TAGame.PRI_TA:ClientLoadoutsOnline": "LoadoutsOnline", "TAGame.PRI_TA:ClubID": "Int64",
  "TAGame.PRI_TA:CurrentVoiceRoom": "String", "TAGame.PRI_TA:EpicPUID": "String", "TAGame.PRI_TA:KeepUpPossessions": "Int",
  "TAGame.PRI_TA:MatchAssists": "Int", "TAGame.PRI_TA:MatchBreakoutDamage": "Int", "TAGame.PRI_TA:MatchDemolishes": "Int",
  "TAGame.PRI_TA:MatchGoals": "Int", "TAGame.PRI_TA:MatchSaves": "Int", "TAGame.PRI_TA:MatchScore": "Int", "TAGame.PRI_TA:MatchShots": "Int",
  "TAGame.PRI_TA:MaxTimeTillItem": "Int", "TAGame.PRI_TA:PartyLeader": "PartyLeader", "TAGame.PRI_TA:PawnType": "Byte",
  "TAGame.PRI_TA:PersistentCamera": "ActiveActor", "TAGame.PRI_TA:PlayerHistoryKey": "PlayerHistoryKey",
  "TAGame.PRI_TA:PlayerHistoryValid": "Boolean", "TAGame.PRI_TA:PossessionClears": "Int", "TAGame.PRI_TA:PossessionDenials": "Int",
  "TAGame.PRI_TA:PossessionSteals": "Int", "TAGame.PRI_TA:PrimaryTitle": "Title", "TAGame.PRI_TA:ReplicatedGameEvent": "ActiveActor",
  "TAGame.PRI_TA:ReplicatedWorstNetQualityBeyondLatency": "Byte", "TAGame.PRI_TA:RepStatTitles": "RepStatTitle",
  "TAGame.PRI_TA:SecondaryTitle": "Title", "TAGame.PRI_TA:SelfDemolitions": "Int", "TAGame.PRI_TA:SkillTier": "FlaggedByte",
  "TAGame.PRI_TA:SpectatorShortcut": "Int", "TAGame.PRI_TA:SteeringSensitivity": "Float", "TAGame.PRI_TA:TimeTillItem": "Int",
  "TAGame.PRI_TA:Title": "Int", "TAGame.PRI_TA:TotalGameTimePlayed": "Float", "TAGame.PRI_TA:TotalIdleTime": "Float",
  "TAGame.PRI_TA:TotalXP": "Int", "TAGame.PRI_TA:ViralItemActor": "ActiveActor", "TAGame.RBActor_TA:bFrozen": "Boolean",
  "TAGame.RBActor_TA:bIgnoreSyncing": "Boolean", "TAGame.RBActor_TA:bReplayActor": "Boolean",
  "TAGame.RBActor_TA:ReplicatedRBState": "RigidBody", "TAGame.RBActor_TA:TeleportCounter": "Byte", "TAGame.RBActor_TA:WeldedInfo": "Welded",
  "TAGame.RumblePickups_TA:AttachedPickup": "ActiveActor", "TAGame.RumblePickups_TA:ConcurrentItemCount": "Int",
  "TAGame.RumblePickups_TA:PickupInfo": "PickupInfo", "TAGame.SpecialPickup_BallFreeze_TA:RepOrigSpeed": "Float",
  "TAGame.SpecialPickup_BallVelcro_TA:AttachTime": "Float", "TAGame.SpecialPickup_BallVelcro_TA:bBroken": "Boolean",
  "TAGame.SpecialPickup_BallVelcro_TA:bHit": "Boolean", "TAGame.SpecialPickup_BallVelcro_TA:BreakTime": "Float",
  "TAGame.SpecialPickup_Football_TA:WeldedBall": "ActiveActor", "TAGame.SpecialPickup_Rugby_TA:bBallWelded": "Boolean",
  "TAGame.SpecialPickup_Targeted_TA:Targeted": "ActiveActor", "TAGame.Stunlock_TA:Car": "ActiveActor",
  "TAGame.Stunlock_TA:MashTime": "Float", "TAGame.Stunlock_TA:MaxStunTime": "Float", "TAGame.Stunlock_TA:StunTimeRemaining": "Float",
  "TAGame.Team_Soccar_TA:GameScore": "Int", "TAGame.Team_TA:ClubColors": "ClubColors", "TAGame.Team_TA:ClubID": "Int64",
  "TAGame.Team_TA:CustomTeamName": "String", "TAGame.Team_TA:Difficulty": "Int", "TAGame.Team_TA:GameEvent": "ActiveActor",
  "TAGame.Team_TA:LogoData": "LogoData", "TAGame.Vehicle_TA:bDriving": "Boolean", "TAGame.Vehicle_TA:bHasPostMatchCelebration": "Boolean",
  "TAGame.Vehicle_TA:bPodiumMode": "Boolean", "TAGame.Vehicle_TA:bReplicatedHandbrake": "Boolean", "TAGame.Vehicle_TA:InputRestriction": "Byte",
  "TAGame.Vehicle_TA:ReplicatedSteer": "Byte", "TAGame.Vehicle_TA:ReplicatedThrottle": "Byte", "TAGame.VehiclePickup_TA:bNoPickup": "Boolean",
  "TAGame.VehiclePickup_TA:NewReplicatedPickupData": "PickupNew", "TAGame.VehiclePickup_TA:ReplicatedPickupData": "Pickup",
  "TAGame.ViralItemActor_TA:ClientFXInfectedType": "Byte", "TAGame.ViralItemActor_TA:InfectedStatus": "Byte",
};

function normalizeObject(name: string): string {
  const PREFIX = "TheWorld:PersistentLevel.";
  if (name.length <= "TheWorld:PersistentLevel.CrowdActor_TA".length) return name;
  let rest: string | null = null;
  if (name.startsWith(PREFIX)) rest = name.slice(PREFIX.length);
  else {
    const dot = name.indexOf(".");
    if (dot !== -1) {
      const suffix = name.slice(dot + 1);
      if (suffix.startsWith(PREFIX)) rest = suffix.slice(PREFIX.length);
    }
  }
  if (rest === null) return name;
  if (rest.startsWith("CrowdActor_TA")) return "TheWorld:PersistentLevel.CrowdActor_TA";
  if (rest.startsWith("CrowdManager_TA")) return "TheWorld:PersistentLevel.CrowdManager_TA";
  if (rest.startsWith("VehiclePickup_Boost_TA")) return "TheWorld:PersistentLevel.VehiclePickup_Boost_TA";
  if (rest.startsWith("InMapScoreboard_TA")) return "TheWorld:PersistentLevel.InMapScoreboard_TA";
  if (rest.startsWith("BreakOutActor_Platform_TA")) return "TheWorld:PersistentLevel.BreakOutActor_Platform_TA";
  if (rest.startsWith("PlayerStart_Platform_TA")) return "TheWorld:PersistentLevel.PlayerStart_Platform_TA";
  return name;
}

function versionGte(maj: number, min: number, net: number | null, tMaj: number, tMin: number, tNet: number): boolean {
  if (maj !== tMaj) return maj > tMaj;
  if (min !== tMin) return min > tMin;
  return (net || 0) >= tNet;
}

// ---------------------------------------------------------------------
// Public entry point: header fields in, per-player demo/demoed counts out.
// ---------------------------------------------------------------------
export function parseDemoCounts(input: DemoParseInput): DemoParseResult {
  const { buf: bytes, headerEnd, majorVersion, minorVersion, netVersion, numFrames, maxChannels, matchType, buildVersion } = input;

  // --- Body metadata ---
  const br = makeByteReader(bytes);
  br.pos = headerEnd;
  br.u32(); br.u32(); // content size + crc
  br.arr(() => br.fstr()); // levels
  br.arr(() => ({ time: br.f32(), frame: br.i32(), position: br.i32() })); // keyframes
  const networkStreamSize = br.u32();
  const networkStreamStart = br.pos;
  const networkStreamEnd = networkStreamStart + networkStreamSize;
  if (networkStreamEnd > bytes.length) throw new Error("Network stream extends past end of file.");
  br.pos = networkStreamEnd;
  br.arr(() => ({ frame: br.i32(), user: br.fstr(), text: br.fstr() })); // debug strings
  br.arr(() => ({ type: br.fstr(), frame: br.i32() })); // tick marks
  br.arr(() => br.fstr()); // packages
  const objects = br.arr(() => br.fstr());
  br.arr(() => br.fstr()); // names
  br.arr(() => ({ name: br.fstr(), index: br.i32() })); // class indices (unused directly)
  const netCache = br.arr(() => ({
    objectInd: br.i32(), parentId: br.i32(), id: br.i32(),
    properties: br.arr(() => ({ objectInd: br.i32(), streamId: br.i32() })),
  }));

  // --- Object index + hierarchy walk ---
  const nameToFirstIndex = new Map<string, number>();
  objects.forEach((name, i) => { if (!nameToFirstIndex.has(name)) nameToFirstIndex.set(name, i); });
  const byName = (name: string) => (nameToFirstIndex.has(name) ? nameToFirstIndex.get(name)! : null);
  function* hierarchy(startName: string): Generator<number> {
    let name = startName;
    for (;;) {
      const current = name;
      const parent = PARENT_CLASSES[normalizeObject(current)];
      if (parent === undefined) {
        const id = byName(current);
        if (id !== null) yield id;
        return;
      }
      name = parent;
      const id = byName(current);
      if (id !== null) yield id;
    }
  }

  // --- Spawn trajectory per object id ---
  const spawns: (number | null)[] = new Array(objects.length).fill(null);
  for (const [className, traj] of SPAWN_STATS) {
    const id = byName(className);
    if (id !== null) spawns[id] = traj;
  }
  for (const name of objects) {
    let result = SPAWN_NONE;
    const parentStack: number[] = [];
    for (const objId of hierarchy(name)) {
      if (spawns[objId] !== null) { result = spawns[objId]!; break; }
      parentStack.push(objId);
    }
    for (const ind of parentStack) spawns[ind] = result;
  }

  // --- Net cache -> per-object merged attribute map ---
  const netPropertiesByClassObjInd = new Map<number, [number, { attribute: string; objectId: number; propName: string }][]>();
  for (const cache of netCache) {
    const key = cache.objectInd;
    if (!netPropertiesByClassObjInd.has(key)) netPropertiesByClassObjInd.set(key, []);
    const list = netPropertiesByClassObjInd.get(key)!;
    for (const p of cache.properties) {
      const propName = objects[p.objectInd];
      const tag = ATTRIBUTES[propName] || "NotImplemented";
      list.push([p.streamId, { attribute: tag, objectId: p.objectInd, propName }]);
    }
  }
  const objectIndAttrs = new Map<number, [number, { attribute: string; objectId: number; propName: string }][]>();
  function netTraversal(objectName: string) {
    const accAttrs: [number, { attribute: string; objectId: number; propName: string }][] = [];
    const parentStack: number[] = [];
    for (const obj of hierarchy(objectName)) {
      if (objectIndAttrs.has(obj)) { for (const kv of objectIndAttrs.get(obj)!) accAttrs.push(kv); break; }
      parentStack.push(obj);
    }
    for (let i = parentStack.length - 1; i >= 0; i--) {
      const ind = parentStack[i];
      const own = netPropertiesByClassObjInd.get(ind) || [];
      for (const kv of own) accAttrs.push(kv);
      objectIndAttrs.set(ind, accAttrs.map((kv) => kv)); // snapshot copy
    }
  }
  for (const name of objects) netTraversal(name);
  type CacheInfo = { maxPropId: number; propIdBits: number; attributes: Map<number, { attribute: string; objectId: number; propName: string }> };
  const cacheInfoByObjId: (CacheInfo | null)[] = new Array(objects.length).fill(null);
  for (const [objId, attrsList] of objectIndAttrs) {
    const m = new Map<number, { attribute: string; objectId: number; propName: string }>();
    for (const [k, v] of attrsList) m.set(k, v);
    let max = 2;
    for (const k of m.keys()) if (k > max) max = k;
    max = max + 1;
    const propIdBits = Math.max(bitWidth(max), 1) - 1;
    cacheInfoByObjId[objId] = { maxPropId: max, propIdBits, attributes: m };
  }

  // --- Frame decode setup ---
  const channelBits = Math.max(bitWidth(maxChannels) - 1, 0);
  const isLan = matchType === "Lan";
  const doParseName = versionGte(majorVersion, minorVersion, netVersion, 868, 20, 0) ||
    (versionGte(majorVersion, minorVersion, netVersion, 868, 14, 0) && !isLan);
  const netVer = netVersion || 0;

  const colorInd = byName("TAGame.ProductAttribute_UserColor_TA") ?? 0;
  const paintedInd = byName("TAGame.ProductAttribute_Painted_TA") ?? 0;
  const titleInd = byName("TAGame.ProductAttribute_TitleID_TA") ?? 0;
  const specialEditionInd = byName("TAGame.ProductAttribute_SpecialEdition_TA") ?? 0;
  const teamEditionInd = byName("TAGame.ProductAttribute_TeamEdition_TA") ?? 0;

  function decodeText(bits: BitReader): string {
    const size = bits.readI32();
    if (size === null) throw new Error("EOF decoding text size");
    if (size === 0) return "";
    if (size < 0) {
      const buf16 = bits.readBytes(size * -2);
      if (!buf16) throw new Error("EOF decoding UTF-16 text");
      const s = new TextDecoder("utf-16le").decode(buf16);
      const t = s.indexOf("\0");
      return t === -1 ? s : s.slice(0, t);
    }
    const bufA = bits.readBytes(size);
    if (!bufA) throw new Error("EOF decoding text");
    const s = new TextDecoder("windows-1252").decode(bufA);
    const t = s.indexOf("\0");
    return t === -1 ? s : s.slice(0, t);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- return shape varies by system_id, mirrors the untyped reference decoder
  function decodeUniqueIdWithSystem(bits: BitReader, system_id: number): any {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let remote_id: any;
    switch (system_id) {
      case 0: remote_id = { kind: "SplitScreen", value: bits.readBitsN(24) }; break;
      case 1: remote_id = { kind: "Steam", value: bits.readU64()!.toString() }; break;
      case 2: {
        const nameBuf = bits.readBytes(16)!;
        let end = nameBuf.indexOf(0); if (end === -1) end = nameBuf.length;
        const name = new TextDecoder("windows-1252").decode(nameBuf.subarray(0, end));
        bits.readBytes(netVer >= 1 ? 16 : 8);
        remote_id = { kind: "PlayStation", name, online_id: bits.readU64()!.toString() };
        break;
      }
      case 4: remote_id = { kind: "Xbox", value: bits.readU64()!.toString() }; break;
      case 5: remote_id = { kind: "QQ", value: bits.readU64()!.toString() }; break;
      case 6: { const online_id = bits.readU64()!.toString(); bits.readBytes(24); remote_id = { kind: "Switch", online_id }; break; }
      case 7: {
        const online_id = bits.readU64()!.toString();
        if (netVer < 10) bits.readBytes(24);
        remote_id = { kind: "PsyNet", online_id };
        break;
      }
      case 11: remote_id = { kind: "Epic", value: decodeText(bits) }; break;
      default: throw new Error("Unrecognized remote id system " + system_id);
    }
    const local_id = bits.readU8();
    return { system_id, remote_id, local_id };
  }
  function decodeUniqueId(bits: BitReader) { const system_id = bits.readU8()!; return decodeUniqueIdWithSystem(bits, system_id); }
  function decodeExplosion(bits: BitReader) {
    const flag = bits.readBit(); const actor = bits.readI32(); const location = decodeVector3f(bits, netVer);
    return { flag, actor, location };
  }
  function decodeLoadout(bits: BitReader) {
    const version = bits.readU8()!;
    const body = bits.readU32(), decal = bits.readU32(), wheels = bits.readU32(), rocket_trail = bits.readU32(),
      antenna = bits.readU32(), topper = bits.readU32(), unknown1 = bits.readU32();
    const unknown2 = version > 10 ? bits.readU32() : null;
    let engine_audio = null, trail = null, goal_explosion = null;
    if (version >= 16) { engine_audio = bits.readU32(); trail = bits.readU32(); goal_explosion = bits.readU32(); }
    const banner = version >= 17 ? bits.readU32() : null;
    const product_id = version >= 19 ? bits.readU32() : null;
    if (version >= 22) { bits.readU32(); bits.readU32(); bits.readU32(); }
    return { version, body, decal, wheels, rocket_trail, antenna, topper, unknown1, unknown2, engine_audio, trail, goal_explosion, banner, product_id };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- return shape varies by product kind, mirrors the untyped reference decoder
  function decodeProduct(bits: BitReader): any {
    const unknown = bits.readBit();
    const obj_ind = bits.readI32();
    let value;
    if (obj_ind === colorInd) {
      if (versionGte(majorVersion, minorVersion, netVersion, 868, 23, 8)) value = { kind: "NewColor", v: bits.readU32() };
      else { const v = bits.ifGet((b) => b.readBitsN(31)); value = v == null ? { kind: "NoColor" } : { kind: "OldColor", v }; }
    } else if (obj_ind === paintedInd) {
      if (versionGte(majorVersion, minorVersion, netVersion, 868, 18, 0)) value = { kind: "NewPaint", v: bits.readBitsN(31) };
      else value = { kind: "OldPaint", v: bits.readBitsMaxComputed(3, 14) };
    } else if (obj_ind === titleInd) {
      value = { kind: "Title", v: decodeText(bits) };
    } else if (obj_ind === specialEditionInd) {
      value = { kind: "SpecialEdition", v: bits.readBitsN(31) };
    } else if (obj_ind === teamEditionInd) {
      if (versionGte(majorVersion, minorVersion, netVersion, 868, 18, 0)) value = { kind: "NewTeamEdition", v: bits.readBitsN(31) };
      else value = { kind: "OldTeamEdition", v: bits.readBitsMaxComputed(3, 14) };
    } else {
      value = { kind: "Absent" };
    }
    return { unknown, obj_ind, value };
  }
  function decodeOnlineLoadout(bits: BitReader) {
    const size = bits.readU8()!;
    const res = [];
    for (let i = 0; i < size; i++) {
      const attrSize = bits.readU8()!;
      const products = [];
      for (let j = 0; j < attrSize; j++) products.push(decodeProduct(bits));
      res.push(products);
    }
    return res;
  }
  function decodeActiveActor(bits: BitReader) { return { active: bits.readBitsN(1) === 1, actor: bits.readI32() }; }

  const isRl223 = typeof buildVersion === "string" && buildVersion >= "221120.42953.406184";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- return shape varies by attribute tag (~40 cases), mirrors the untyped reference decoder
  function decodeAttribute(tag: string, bits: BitReader): any {
    switch (tag) {
      case "Boolean": return bits.readBit();
      case "Byte": return bits.readU8();
      case "ActiveActor": return decodeActiveActor(bits);
      case "RigidBody": {
        const sleeping = bits.readBit();
        const location = decodeVector3f(bits, netVer);
        const rotation = netVer >= 7 ? decodeQuaternion(bits) : decodeQuaternionCompressed(bits);
        let linear = null, angular = null;
        if (!sleeping) { linear = decodeVector3f(bits, netVer); angular = decodeVector3f(bits, netVer); }
        return { sleeping, location, rotation, linear, angular };
      }
      case "Float": return bits.readF32();
      case "Int": return bits.readI32();
      case "Int64": return bits.readI64();
      case "Enum": return bits.readBitsN(11);
      case "RotationTag": return decodeRotation(bits);
      case "String": return decodeText(bits);
      case "QWordString": return isRl223 ? decodeText(bits) : bits.readU64()!.toString();
      case "Demolish": {
        const attacker_flag = bits.readBit(), attacker = bits.readI32(), victim_flag = bits.readBit(), victim = bits.readI32();
        return { attacker_flag, attacker, victim_flag, victim, attack_velocity: decodeVector3f(bits, netVer), victim_velocity: decodeVector3f(bits, netVer) };
      }
      case "DemolishFx": {
        const custom_demo_flag = bits.readBit(), custom_demo_id = bits.readI32();
        const attacker_flag = bits.readBit(), attacker = bits.readI32(), victim_flag = bits.readBit(), victim = bits.readI32();
        return { custom_demo_flag, custom_demo_id, attacker_flag, attacker, victim_flag, victim, attack_velocity: decodeVector3f(bits, netVer), victim_velocity: decodeVector3f(bits, netVer) };
      }
      case "DemolishExtended": {
        const attacker_pri = decodeActiveActor(bits), self_demo = decodeActiveActor(bits), self_demolish = bits.readBit();
        const goal_explosion_owner = decodeActiveActor(bits), attacker = decodeActiveActor(bits), victim = decodeActiveActor(bits);
        return { attacker_pri, self_demo, self_demolish, goal_explosion_owner, attacker, victim, attacker_velocity: decodeVector3f(bits, netVer), victim_velocity: decodeVector3f(bits, netVer) };
      }
      case "Location": return decodeVector3f(bits, netVer);
      case "UniqueId": return decodeUniqueId(bits);
      case "Reservation": {
        const number = bits.readBitsN(3);
        const unique = decodeUniqueId(bits);
        let name = null;
        if (unique.system_id !== 0) name = decodeText(bits);
        else if (!(unique.remote_id.kind === "SplitScreen" && unique.remote_id.value === 0)) {
          let s = "";
          for (let i = 0; i < 255; i++) { const c = bits.readU8()!; if (c === 0) break; s += String.fromCharCode(c); }
          name = s;
        }
        const unknown1 = bits.readBit(), unknown2 = bits.readBit();
        const unknown3 = versionGte(majorVersion, minorVersion, netVersion, 868, 12, 0) ? bits.readBitsN(6) : null;
        return { number, unique, name, unknown1, unknown2, unknown3 };
      }
      case "PartyLeader": { const system_id = bits.readU8()!; return system_id !== 0 ? decodeUniqueIdWithSystem(bits, system_id) : null; }
      case "PrivateMatchSettings": {
        const mutators = decodeText(bits), joinable_by = bits.readU32(), max_players = bits.readU32();
        const game_name = decodeText(bits), password = decodeText(bits), flag = bits.readBit();
        return { mutators, joinable_by, max_players, game_name, password, flag };
      }
      case "AppliedDamage": {
        const id = bits.readU8(), position = decodeVector3f(bits, netVer), damage_index = bits.readI32(), total_damage = bits.readI32();
        return { id, position, damage_index, total_damage };
      }
      case "DamageState": {
        const tile_state = bits.readU8(), damaged = bits.readBit(), offender = bits.readI32();
        const ball_position = decodeVector3f(bits, netVer), direct_hit = bits.readBit(), unknown1 = bits.readBit();
        return { tile_state, damaged, offender, ball_position, direct_hit, unknown1 };
      }
      case "CamSettings": {
        const fov = bits.readF32(), height = bits.readF32(), angle = bits.readF32(), distance = bits.readF32(),
          stiffness = bits.readF32(), swivel = bits.readF32();
        const transition = versionGte(majorVersion, minorVersion, netVersion, 868, 20, 0) ? bits.readF32() : null;
        return { fov, height, angle, distance, stiffness, swivel, transition };
      }
      case "ClubColors": {
        const blue_flag = bits.readBit(), blue_color = bits.readU8(), orange_flag = bits.readBit(), orange_color = bits.readU8();
        return { blue_flag, blue_color, orange_flag, orange_color };
      }
      case "Explosion": return decodeExplosion(bits);
      case "ExtendedExplosion": { const explosion = decodeExplosion(bits); const unknown1 = bits.readBit(); const secondary_actor = bits.readI32(); return { explosion, unknown1, secondary_actor }; }
      case "FlaggedByte": return { b: bits.readBit(), data: bits.readU8() };
      case "GameMode": { const init = versionGte(majorVersion, minorVersion, netVersion, 868, 12, 0) ? 8 : 2; return { init, value: bits.readBitsN(init) }; }
      case "Loadout": return decodeLoadout(bits);
      case "TeamLoadout": return { blue: decodeLoadout(bits), orange: decodeLoadout(bits) };
      case "MusicStinger": return { flag: bits.readBit(), cue: bits.readU32(), trigger: bits.readU8() };
      case "PlayerHistoryKey": return bits.readBitsN(14);
      case "Pickup": return { instigator: bits.ifGet((b) => b.readI32()), picked_up: bits.readBit() };
      case "PickupNew": return { instigator: bits.ifGet((b) => b.readI32()), picked_up: bits.readU8() };
      case "Welded": {
        const active = bits.readBit(), actor = bits.readI32(), offset = decodeVector3f(bits, netVer), mass = bits.readF32(), rotation = decodeRotation(bits);
        return { active, actor, offset, mass, rotation };
      }
      case "Title": return [bits.readBit(), bits.readBit(), bits.readU32(), bits.readU32(), bits.readU32(), bits.readU32(), bits.readU32(), bits.readBit()];
      case "TeamPaint": {
        const team = bits.readU8(), primary_color = bits.readU8(), accent_color = bits.readU8(), primary_finish = bits.readU32(), accent_finish = bits.readU32();
        return { team, primary_color, accent_color, primary_finish, accent_finish };
      }
      case "StatEvent": return { unknown1: bits.readBit(), object_id: bits.readI32() };
      case "RepStatTitle": {
        const unknown = bits.readBit(), name = decodeText(bits), unknown2 = bits.readBit(), index = bits.readU32(), value = bits.readU32();
        return { unknown, name, unknown2, index, value };
      }
      case "PickupInfo": return { available_pickups: [decodeActiveActor(bits), decodeActiveActor(bits), decodeActiveActor(bits)], items_are_preview: bits.readBit() };
      case "Impulse": return { compressed_rotation: bits.readI32(), speed: bits.readF32() };
      case "ReplicatedBoost": return { grant_count: bits.readU8(), boost_amount: bits.readU8(), unused1: bits.readU8(), unused2: bits.readU8() };
      case "LogoData": return { logo_id: bits.readU32(), swap_colors: bits.readBit() };
      case "LoadoutOnline": return decodeOnlineLoadout(bits);
      case "LoadoutsOnline": return { blue: decodeOnlineLoadout(bits), orange: decodeOnlineLoadout(bits), unknown1: bits.readBit(), unknown2: bits.readBit() };
      case "NotImplemented": throw new Error("Unrecognized replicated property — likely an unsupported replay/engine version.");
      default: throw new Error("Unhandled attribute tag: " + tag);
    }
  }

  function parseNewActor(bits: BitReader, actorId: number) {
    let nameId = null;
    if (doParseName) nameId = bits.readI32();
    bits.readBit();
    const objectId = bits.readI32();
    if (objectId === null || objectId < 0 || objectId >= objects.length) throw new Error("New actor references out-of-range object id " + objectId);
    const spawn = spawns[objectId];
    let location = null, rotation = null;
    if (spawn === SPAWN_LOCATION) location = decodeVector3i(bits, netVer);
    else if (spawn === SPAWN_LOC_ROT) { location = decodeVector3i(bits, netVer); rotation = decodeRotation(bits); }
    return { actorId, nameId, objectId, location, rotation };
  }

  // --- Frame decode: inline processing (see module header for why this
  // deviates from the reference's flat-array-then-postprocess structure) ---
  const netBits = new BitReader(bytes, networkStreamStart, networkStreamEnd);
  const actors = new Map<number, { objectId: number; cacheInfo: CacheInfo }>();
  const priNameByActor = new Map<number, string>();
  const carToPri = new Map<number, number>();
  type DemolishRaw = { carActor: number; attackerCar: number | null; victimCar: number | null; attackerPriDirect: number | null; selfDemolish: boolean | null };
  const demolishRaw: DemolishRaw[] = [];
  let frameCount = 0;
  const targetFrames = numFrames;

  while (!netBits.isEmpty() && frameCount < targetFrames) {
    const time = netBits.readF32();
    if (time === null) break;
    const delta = netBits.readF32();
    if (delta === null) break;
    if (time === 0 && delta === 0) break;

    for (;;) {
      const cont = netBits.readBit();
      if (cont === null) throw new Error("Unexpected end of network stream (actor list).");
      if (!cont) break;
      const actorId = netBits.readBitsMaxComputed(channelBits, maxChannels);
      if (actorId === null) throw new Error("Unexpected end of network stream (actor id).");
      const alive = netBits.readBit();
      if (alive) {
        const isNew = netBits.readBit();
        if (isNew) {
          const actor = parseNewActor(netBits, actorId);
          const cacheInfo = cacheInfoByObjId[actor.objectId];
          if (!cacheInfo) throw new Error("Missing net-cache info for spawned object " + objects[actor.objectId]);
          actors.set(actorId, { objectId: actor.objectId, cacheInfo });
        } else {
          const entry = actors.get(actorId);
          if (!entry) throw new Error("Update referenced an unknown actor id " + actorId);
          for (;;) {
            const more = netBits.readBit();
            if (more === null) throw new Error("Unexpected end of network stream (property list).");
            if (!more) break;
            const streamId = netBits.readBitsMaxComputed(entry.cacheInfo.propIdBits, entry.cacheInfo.maxPropId);
            if (streamId === null) throw new Error("Unexpected end of network stream (stream id).");
            const attr = entry.cacheInfo.attributes.get(streamId);
            if (!attr) throw new Error("Unknown replicated property id on " + objects[entry.objectId]);
            const value = decodeAttribute(attr.attribute, netBits);

            switch (attr.propName) {
              case "Engine.PlayerReplicationInfo:PlayerName": priNameByActor.set(actorId, value); break;
              case "Engine.Pawn:PlayerReplicationInfo": if (value.active) carToPri.set(actorId, value.actor); break;
            }
            if (attr.attribute === "Demolish" || attr.attribute === "DemolishFx") {
              demolishRaw.push({ carActor: actorId, attackerCar: value.attacker, victimCar: value.victim, attackerPriDirect: null, selfDemolish: null });
            } else if (attr.attribute === "DemolishExtended") {
              demolishRaw.push({
                carActor: actorId,
                attackerCar: value.attacker.active ? value.attacker.actor : null,
                victimCar: value.victim.active ? value.victim.actor : null,
                attackerPriDirect: value.attacker_pri.active ? value.attacker_pri.actor : null,
                selfDemolish: value.self_demolish,
              });
            }
          }
        }
      } else {
        // Only removes the frame-decode cache-info lookup entry. Per the
        // module header: never also clear carToPri/priNameByActor here.
        actors.delete(actorId);
      }
    }
    frameCount++;
  }

  // --- Post-process: resolve demolitions against the FINAL car->PRI state ---
  const demoCountByName = new Map<string, number>();
  const demoedCountByName = new Map<string, number>();
  for (const d of demolishRaw) {
    const attackerPri = d.attackerPriDirect ?? (d.attackerCar != null ? carToPri.get(d.attackerCar) : null) ?? null;
    const victimPri = d.victimCar != null ? carToPri.get(d.victimCar) : null;
    const attacker = attackerPri != null ? priNameByActor.get(attackerPri) ?? null : null;
    const victim = victimPri != null ? priNameByActor.get(victimPri) ?? null : null;
    if (!attacker || !victim) continue;
    demoCountByName.set(attacker, (demoCountByName.get(attacker) || 0) + 1);
    demoedCountByName.set(victim, (demoedCountByName.get(victim) || 0) + 1);
  }

  const counts = new Map<string, PlayerDemoCounts>();
  const names = new Set([...demoCountByName.keys(), ...demoedCountByName.keys()]);
  for (const name of names) {
    counts.set(name, { demos: demoCountByName.get(name) || 0, demoed: demoedCountByName.get(name) || 0 });
  }
  return { counts, frameCoverage: targetFrames > 0 ? frameCount / targetFrames : 0 };
}
