const Order = require("../models/order");
const User = require("../models/User");
const BehaviorLog = require("../models/BehaviorLog");
const settings = require("./settingsService");

const since = (ms) => new Date(Date.now() - ms);
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

exports.record = (user, type, order, meta) =>
  BehaviorLog.create({ user, type, order, meta });

const count = (user, type, from) =>
  BehaviorLog.countDocuments({ user, type, createdAt: { $gte: from } });

/**
 * Evaluate the risk of an action. Returns { score, flags, threshold, suspicious }.
 * `event` is one of: "create" | "cancel" | "refund".
 * Behaviour must be recorded (BehaviorLog) BEFORE calling so counts include the current action.
 */
exports.evaluate = async ({ user, event, order, couponInfo }) => {
  const cfg = await settings.get("fraud");
  const r = cfg.rules;
  const flags = [];
  const add = (rule, points, detail) => flags.push({ rule, points, detail });

  // 1. Many orders in a very short time
  const recent = await count(user._id, "ORDER_CREATED", since(r.rapidOrders.windowMinutes * MIN));
  if (recent >= r.rapidOrders.severeLimit) {
    add("RAPID_ORDERS", r.rapidOrders.severePoints, `${recent} orders in ${r.rapidOrders.windowMinutes} min`);
  } else if (recent >= r.rapidOrders.limit) {
    add("RAPID_ORDERS", r.rapidOrders.points, `${recent} orders in ${r.rapidOrders.windowMinutes} min`);
  }

  // 2. Repeated cancellations
  const cancels = await count(user._id, "ORDER_CANCELLED", since(r.repeatedCancellations.windowHours * HOUR));
  if (cancels >= r.repeatedCancellations.limit) {
    add("REPEATED_CANCELLATIONS", r.repeatedCancellations.points, `${cancels} cancellations in ${r.repeatedCancellations.windowHours}h`);
  }

  // 3. Abnormal coupon usage
  const coupons = await count(user._id, "COUPON_USED", since(r.couponAbuse.windowHours * HOUR));
  if (coupons >= r.couponAbuse.limit) {
    add("COUPON_ABUSE", r.couponAbuse.points, `${coupons} coupon redemptions in ${r.couponAbuse.windowHours}h`);
  }
  if (couponInfo && couponInfo.subtotal > 0 && couponInfo.discount / couponInfo.subtotal > r.couponAbuse.maxDiscountRatio) {
    add("COUPON_HIGH_DISCOUNT", r.couponAbuse.ratioPoints, `discount is ${Math.round((couponInfo.discount / couponInfo.subtotal) * 100)}% of order value`);
  }

  // 4. Excessive refund requests
  const refunds = await count(user._id, "REFUND_REQUESTED", since(r.excessiveRefunds.windowDays * DAY));
  if (refunds >= r.excessiveRefunds.limit) {
    add("EXCESSIVE_REFUNDS", r.excessiveRefunds.points, `${refunds} refund requests in ${r.excessiveRefunds.windowDays}d`);
  }

  // 5. Order-value based signals (only meaningful when creating)
  if (event === "create" && order) {
    const ageH = (Date.now() - new Date(user.createdAt).getTime()) / HOUR;
    if (ageH < r.newAccountHighValue.accountAgeHours && order.totalAmount >= r.newAccountHighValue.amount) {
      add("NEW_ACCOUNT_HIGH_VALUE", r.newAccountHighValue.points, `account is ${Math.round(ageH * 60)} min old, order ₹${order.totalAmount}`);
    }
    if (order.totalAmount >= r.highValueOrder.amount) {
      add("HIGH_VALUE_ORDER", r.highValueOrder.points, `order value ₹${order.totalAmount}`);
    }
  }

  const score = Math.min(100, flags.reduce((s, f) => s + f.points, 0));
  return { score, flags, threshold: cfg.threshold, suspicious: score >= cfg.threshold };
};

exports.applyToOrder = (order, result) => {
  order.riskScore = result.score;
  order.riskFlags = result.flags;
  if (result.suspicious) order.fraudStatus = "flagged";
};

// ---- Admin actions ----
exports.restrictUser = async (userId, hours, reason) => {
  const cfg = await settings.get("fraud");
  const h = Number(hours) > 0 ? Number(hours) : cfg.restrictionHours;
  return User.findByIdAndUpdate(
    userId,
    { restrictedUntil: new Date(Date.now() + h * HOUR), restrictionReason: reason || "Suspicious activity" },
    { returnDocument: "after" },
  );
};

exports.listFlagged = async ({ status = "flagged", page = 1, limit = 20, minRisk = 0 }) => {
  const q = {};
  if (status !== "all") q.fraudStatus = status;
  if (Number(minRisk) > 0) q.riskScore = { $gte: Number(minRisk) };
  const p = Math.max(1, Number(page));
  const l = Math.min(100, Math.max(1, Number(limit)));
  const [data, total] = await Promise.all([
    Order.find(q)
      .sort({ riskScore: -1, createdAt: -1 })
      .skip((p - 1) * l)
      .limit(l)
      .populate("user", "name email restrictedUntil isblocked")
      .populate("restaurant", "name"),
    Order.countDocuments(q),
  ]);
  return { data, total, page: p, pages: Math.ceil(total / l) };
};
