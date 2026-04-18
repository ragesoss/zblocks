// Pure encoders for Wikifunctions numeric types. Shared by emitter.js
// (block → ZObject) and runner.js (test input → ZObject) so both
// paths produce identical output for the same numeric value.
//
// Sign (Z16659) values: Z16660 positive, Z16661 zero, Z16662 negative.
//
// The Float64 encoding is ported from numeric_io.ts in YoshiRulz's
// WikiLambdaBlockly prototype (Apache-2.0). It decomposes a JS
// number into IEEE 754 bit fields via a DataView and packages them
// in the Z20838 / Z20825 structure the runtime expects, handling
// subnormals, signed zero, infinities, and NaN as distinct special
// cases. Deferred: Z19702 rational encoder — same pattern, add when
// we need a Z19677 literal block.

export const SIGN_POS  = "Z16660";
export const SIGN_ZERO = "Z16661";
export const SIGN_NEG  = "Z16662";

// ─── Integer (Z16683) ──────────────────────────────────────────────
export function encodeInteger(n) {
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new RangeError(`encodeInteger: not an integer: ${JSON.stringify(n)}`);
  }
  const sign = n > 0 ? SIGN_POS : n < 0 ? SIGN_NEG : SIGN_ZERO;
  return {
    Z1K1: "Z16683",
    Z16683K1: { Z1K1: "Z16659", Z16659K1: sign },
    Z16683K2: { Z1K1: "Z13518", Z13518K1: String(Math.abs(n)) },
  };
}

// ─── Natural number (Z13518) ───────────────────────────────────────
export function encodeNatural(n) {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new RangeError(`encodeNatural: not a non-negative integer: ${JSON.stringify(n)}`);
  }
  return { Z1K1: "Z13518", Z13518K1: String(n) };
}

// ─── Float64 (Z20838) ──────────────────────────────────────────────
//
// Wrapper helper so special-value / normal-value results share a shape.
// exponent is the unbiased signed exponent; mantissa is a BigInt holding
// the 52 fractional bits (for normals) or the raw 52 bits (for subnormals).
function buildZ20838(positive, exponent, mantissa, specialZid) {
  return {
    Z1K1: "Z20838",
    Z20838K1: { Z1K1: "Z16659", Z16659K1: positive ? SIGN_POS : SIGN_NEG },
    Z20838K2: {
      Z1K1: "Z16683",
      Z16683K1: {
        Z1K1: "Z16659",
        Z16659K1: exponent < 0 ? SIGN_NEG : exponent === 0 ? SIGN_ZERO : SIGN_POS,
      },
      Z16683K2: { Z1K1: "Z13518", Z13518K1: String(Math.abs(exponent)) },
    },
    Z20838K3: { Z1K1: "Z13518", Z13518K1: mantissa.toString() },
    Z20838K4: { Z1K1: "Z20825", Z20825K1: specialZid },
  };
}

export function encodeFloat64(num) {
  if (Number.isNaN(num))                      return buildZ20838(true,  1024, (2n ** 52n) - 1n, "Z20834");
  if (num === Number.POSITIVE_INFINITY)       return buildZ20838(true,  1024, 0n,              "Z20832");
  if (num === Number.NEGATIVE_INFINITY)       return buildZ20838(false, 1024, 0n,              "Z20833");
  if (Object.is(num, -0))                     return buildZ20838(false, -1023, 0n,             "Z20831");
  if (num === 0)                              return buildZ20838(true,  -1023, 0n,             "Z20829");

  const positive = num >= 0;
  const absval = positive ? num : -num;

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, absval, false);        // big-endian
  const bits = view.getBigUint64(0, false);

  const rawExp = (bits >> 52n) & 0x7FFn;
  const mantissa = bits % (2n ** 52n);
  const exponent = rawExp === 0n
    ? -1023                                   // subnormal
    : Number(rawExp - 1023n);                 // normal (remove bias)

  return buildZ20838(positive, exponent, mantissa, "Z20837");
}

// ─── Decoders (ZObject → JS number) ────────────────────────────────
// Tolerate both expanded form (wrapped Z6 objects) and canonical form
// (bare strings) for nested scalar fields, since the server accepts
// either on write but normalises on read.

function asScalar(v) {
  if (v === undefined || v === null) return v;
  if (typeof v === "object" && v.Z1K1 === "Z6" && typeof v.Z6K1 === "string") return v.Z6K1;
  if (typeof v === "object" && typeof v.Z9K1 === "string") return v.Z9K1;
  return v;
}

export function decodeNatural(z13518) {
  const digits = asScalar(z13518?.Z13518K1);
  if (typeof digits !== "string" || !/^\d+$/.test(digits)) {
    throw new RangeError(`decodeNatural: invalid Z13518 payload ${JSON.stringify(z13518)}`);
  }
  return Number(digits);
}

export function decodeInteger(z16683) {
  const sign = asScalar(z16683?.Z16683K1?.Z16659K1);
  const n = decodeNatural(z16683?.Z16683K2);
  if (sign === SIGN_NEG) return -n;
  return n;
}

// Port of Z28867 from YoshiRulz's numeric_io.ts. Reassembles the
// sign / biased-exponent / mantissa bit fields back into a Number
// via DataView, including special cases.
export function decodeFloat64(z20838) {
  const special = asScalar(z20838?.Z20838K4?.Z20825K1);
  if (special === "Z20829") return +0.0;
  if (special === "Z20831") return -0.0;
  if (special === "Z20832") return Number.POSITIVE_INFINITY;
  if (special === "Z20833") return Number.NEGATIVE_INFINITY;
  if (special === "Z20834" || special === "Z20835" || special === "Z20836") return Number.NaN;

  const sign = asScalar(z20838?.Z20838K1?.Z16659K1);
  const positive = sign === SIGN_POS ? 0n : 1n;
  const signBit = positive << 63n;

  const expMagnitude = BigInt(decodeNatural(z20838?.Z20838K2?.Z16683K2));
  const expSignZid = asScalar(z20838?.Z20838K2?.Z16683K1?.Z16659K1);
  const exponent = (expSignZid === SIGN_NEG ? -1n : 1n) * expMagnitude;
  if (exponent > 1023n || exponent < -1023n) return Number.NaN;

  const mantValue = BigInt(asScalar(z20838?.Z20838K3?.Z13518K1));

  let exponentBits, mantissaBits;
  if (exponent === -1023n) {
    exponentBits = 0n;
    mantissaBits = mantValue;
  } else {
    exponentBits = ((exponent + 1023n) & 0x7FFn) << 52n;
    const MANT_MASK = (1n << 52n) - 1n;
    mantissaBits = mantValue & MANT_MASK;
  }
  const floatBits = signBit | exponentBits | mantissaBits;

  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, floatBits, false);
  return view.getFloat64(0, false);
}
