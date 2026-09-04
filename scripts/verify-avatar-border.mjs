// Checks that a catalog entry's `opening` actually fits its art.
//
//   node scripts/verify-avatar-border.mjs tech [outfile.png]
//
// Composites a test avatar into the frame at exactly the percentages
// avatarBorderFrameStyle() computes, then reads the result back looking for the
// one defect the geometry can produce that code review cannot see: page
// background showing through a gap between the avatar edge and the frame.
//
// The page is painted magenta and gaps are found by flood-filling magenta
// inward from the canvas border. Magenta the fill cannot reach is enclosed by
// art, so it is a real hole; magenta it can reach is just the transparent
// corners outside the frame. Colour-matching an avatar rim instead would
// misreport on dark art, which several of these frames are.
import fs from "fs";
import sharp from "sharp";

const [id, out = `border-check-${process.argv[2]}.png`] = process.argv.slice(2);
if (!id) throw new Error("usage: verify-avatar-border.mjs <border-id> [outfile]");

const catalog = fs.readFileSync("app/lib/avatar-borders.ts", "utf8");
const entry = catalog.split(/\n  \{\n/).find((b) => b.includes(`id: "${id}"`));
if (!entry) throw new Error(`no catalog entry for "${id}"`);

// Read straight out of the catalog so the check can never drift from what the
// app renders.
const fields = (field) =>
  Object.fromEntries(
    entry
      .match(new RegExp(field + ": [{]([^}]+)[}]"))[1]
      .split(",")
      .map((pair) => pair.split(":"))
      .map(([k, v]) => [k.trim(), Number(v)]),
  );
const measured = fields("measured");
const opening = fields("opening");
const src = "public" + entry.match(/src: "([^"]+)"/)[1];

const diameter = Math.max(opening.right - opening.left, opening.bottom - opening.top);
const pct = {
  w: measured.width / diameter,
  h: measured.height / diameter,
  l: 0.5 - (opening.left + opening.right) / 2 / diameter,
  t: 0.5 - (opening.top + opening.bottom) / 2 / diameter,
};
console.log(
  `${id}: frame ${(pct.w * 100).toFixed(3)}% x ${(pct.h * 100).toFixed(3)}% ` +
    `at ${(pct.l * 100).toFixed(3)}%, ${(pct.t * 100).toFixed(3)}%`,
);

const S = 512;
const fw = Math.round(pct.w * S);
const fh = Math.round(pct.h * S);
const ax = -Math.round(pct.l * S);
const ay = -Math.round(pct.t * S);
const cw = Math.max(fw, ax + S);
const ch = Math.max(fh, ay + S);

const av = Buffer.alloc(S * S * 4);
const radius = S / 2;
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const i = (y * S + x) * 4;
    if (Math.hypot(x - radius + 0.5, y - radius + 0.5) > radius) continue;
    const cell = (Math.floor(x / 32) + Math.floor(y / 32)) % 2 === 0;
    av[i] = cell ? 232 : 55;
    av[i + 1] = cell ? 138 : 54;
    av[i + 2] = cell ? 36 : 172;
    av[i + 3] = 255;
  }
}

const composed = await sharp({
  create: {
    width: cw,
    height: ch,
    channels: 4,
    background: { r: 255, g: 0, b: 255, alpha: 1 },
  },
})
  .composite([
    {
      input: await sharp(av, { raw: { width: S, height: S, channels: 4 } }).png().toBuffer(),
      left: ax,
      top: ay,
    },
    { input: await sharp(src).resize(fw, fh).png().toBuffer(), left: 0, top: 0 },
  ])
  .png()
  .toBuffer();
await sharp(composed).toFile(out);

const { data, info } = await sharp(composed).raw().toBuffer({ resolveWithObject: true });
const isBg = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return data[i] > 240 && data[i + 1] < 40 && data[i + 2] > 240;
};

const seen = new Uint8Array(info.width * info.height);
const stack = [];
const push = (x, y) => {
  const i = y * info.width + x;
  if (!seen[i] && isBg(x, y)) {
    seen[i] = 1;
    stack.push([x, y]);
  }
};
for (let x = 0; x < info.width; x++) {
  push(x, 0);
  push(x, info.height - 1);
}
for (let y = 0; y < info.height; y++) {
  push(0, y);
  push(info.width - 1, y);
}
while (stack.length) {
  const [x, y] = stack.pop();
  if (x > 0) push(x - 1, y);
  if (y > 0) push(x, y - 1);
  if (x < info.width - 1) push(x + 1, y);
  if (y < info.height - 1) push(x, y + 1);
}

// These frames legitimately have see-through pockets in their outer decoration,
// and those are enclosed by art too. What actually matters is background
// touching the avatar, so gaps are split by distance from the avatar centre: at
// or just past its rim is a fitting defect, anything further out is the art.
const acx = ax + S / 2;
const acy = ay + S / 2;
let atRim = 0;
let decorative = 0;
let worst = null;
for (let y = 0; y < info.height; y++) {
  for (let x = 0; x < info.width; x++) {
    if (!isBg(x, y) || seen[y * info.width + x]) continue;
    const d = Math.hypot(x - acx, y - acy);
    if (d > S / 2 + 2) {
      decorative++;
      continue;
    }
    atRim++;
    if (!worst || d > worst.d) worst = { x, y, d };
  }
}

// Where the art is actually see-through, for comparison against the stated
// opening: a supplied opening should sit outside it on every side.
const { data: a, info: ai } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const alphaAt = (x, y) => a[(y * ai.width + x) * 4 + 3];
const holeSeen = new Uint8Array(ai.width * ai.height);
const holeStack = [[ai.width >> 1, ai.height >> 1]];
holeSeen[(ai.height >> 1) * ai.width + (ai.width >> 1)] = 1;
let ht = ai.height;
let hb = -1;
let hl = ai.width;
let hr = -1;
while (holeStack.length) {
  const [x, y] = holeStack.pop();
  if (x < hl) hl = x;
  if (x > hr) hr = x;
  if (y < ht) ht = y;
  if (y > hb) hb = y;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= ai.width || ny >= ai.height) continue;
    const i = ny * ai.width + nx;
    if (holeSeen[i] || alphaAt(nx, ny) > 16) continue;
    holeSeen[i] = 1;
    holeStack.push([nx, ny]);
  }
}
const k = measured.width / ai.width;
const hole = {
  left: Math.round(hl * k),
  right: Math.round(hr * k),
  top: Math.round(ht * k),
  bottom: Math.round(hb * k),
};
const superset =
  opening.left <= hole.left &&
  opening.right >= hole.right &&
  opening.top <= hole.top &&
  opening.bottom >= hole.bottom;

console.log(
  `  hole in source px:  left ${hole.left} right ${hole.right} ` +
    `top ${hole.top} bottom ${hole.bottom}`,
);
console.log(
  `  stated opening:     left ${opening.left} right ${opening.right} ` +
    `top ${opening.top} bottom ${opening.bottom}` +
    (superset ? "   (superset of the hole)" : "   <-- NOT a superset"),
);
console.log(
  `  gap at the avatar rim: ${atRim} px` +
    (atRim === 0 ? "  (clean)" : `  <-- GAP, furthest at ${worst.x},${worst.y} of ${cw}x${ch}`),
);
console.log(`  see-through pockets in the outer art: ${decorative} px  (expected, not a defect)`);
console.log(`  wrote ${out}`);
