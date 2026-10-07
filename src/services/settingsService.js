const Setting = require("../models/Setting");

const DEFAULTS = {
  surge: {
    enabled: true,
    baseFee: 30,
    perKmFee: 6,
    freeDeliveryAbove: 0, // 0 = disabled
    utcOffsetMinutes: 330, // IST
    peakHours: [
      { label: "Lunch", start: 12, end: 14, multiplier: 1.5 },
      { label: "Dinner", start: 19, end: 22, multiplier: 1.8 },
    ],
    demand: { windowMinutes: 15, ordersThreshold: 10, stepPerOrder: 0.05 },
    maxMultiplier: 3,
  },
  fraud: {
    threshold: 50,
    rules: {
      rapidOrders: { windowMinutes: 10, limit: 3, points: 30, severePoints: 45, severeLimit: 5 },
      repeatedCancellations: { windowHours: 24, limit: 3, points: 30 },
      couponAbuse: { windowHours: 24, limit: 3, points: 25, maxDiscountRatio: 0.5, ratioPoints: 15 },
      excessiveRefunds: { windowDays: 7, limit: 2, points: 30 },
      newAccountHighValue: { accountAgeHours: 1, amount: 2000, points: 20 },
      highValueOrder: { amount: 5000, points: 15 },
    },
    restrictionHours: 24,
  },
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const merge = (base, over) => {
  const out = clone(base);
  Object.keys(over || {}).forEach((k) => {
    out[k] = isObj(out[k]) && isObj(over[k]) ? merge(out[k], over[k]) : over[k];
  });
  return out;
};

exports.DEFAULTS = DEFAULTS;
exports.merge = merge;

exports.get = async (key) => {
  const doc = await Setting.findOne({ key }).lean();
  return merge(DEFAULTS[key], doc ? doc.value : {});
};

exports.set = async (key, patch) => {
  const current = await exports.get(key);
  const next = merge(current, patch);
  await Setting.findOneAndUpdate({ key }, { value: next }, { upsert: true, returnDocument: "after" });
  return next;
};
