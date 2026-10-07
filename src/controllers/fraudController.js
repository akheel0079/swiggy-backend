const mongoose = require("mongoose");
const Order = require("../models/order");
const Restaurant = require("../models/restaurant");
const fraud = require("../services/fraudService");
const settings = require("../services/settingsService");
const orders = require("../services/orderService");
const delivery = require("../services/deliveryService");
const recommendations = require("../services/recommendationService");
const HttpError = require("../utils/httpError");

// GET /api/admin/fraud/orders?status=flagged|approved|rejected|all&minRisk=&page=&limit=
exports.getFraudOrders = async (req, res) => {
  const result = await fraud.listFlagged(req.query);
  res.json({ success: true, ...result });
};

// PUT /api/admin/fraud/orders/:orderId   body: { action: "approve"|"reject"|"restrict", note, hours }
exports.reviewOrder = async (req, res) => {
  const { orderId } = req.params;
  const { action, note, hours } = req.body;
  if (!mongoose.Types.ObjectId.isValid(orderId)) throw new HttpError(400, "Invalid order id");
  if (!["approve", "reject", "restrict"].includes(action)) {
    throw new HttpError(400, "action must be one of: approve, reject, restrict");
  }
  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, "Order not found");
  if (order.fraudStatus === "clear") throw new HttpError(400, "Order is not flagged");

  order.fraudReview = { reviewedBy: req.user._id, action, note, at: new Date() };
  const wasHeld = order.orderStatus === "Under Review";
  let user;

  if (action === "approve") {
    order.fraudStatus = "approved";
    if (wasHeld) {
      orders.pushStatus(order, "Order Placed", req.user._id, "Approved after fraud review");
      await order.save();
      await Promise.all([
        recommendations.updateProfile(order),
        Restaurant.updateOne({ _id: order.restaurant }, { $inc: { orderCount: 1 } }),
      ]);
      await orders.broadcast(order, { notifyRestaurant: true });
      await delivery.assignPartner(order);
    } else {
      await order.save();
    }
  } else {
    order.fraudStatus = "rejected";
    if (["Under Review", "Order Placed", "Restaurant Accepted", "Preparing Food"].includes(order.orderStatus)) {
      if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";
      await orders.changeStatus(order, "Rejected", req.user, note || "Rejected after fraud review");
    } else {
      await order.save();
    }
    if (action === "restrict") {
      user = await fraud.restrictUser(order.user, hours, note || "Restricted after fraud review");
    }
  }

  res.json({
    success: true,
    message: `Order ${action === "approve" ? "approved" : "rejected"}${action === "restrict" ? " and user restricted" : ""}`,
    data: order,
    ...(user && { restrictedUntil: user.restrictedUntil }),
  });
};

// POST /api/admin/fraud/users/:userId/restrict   body: { hours, reason }   |   DELETE to lift
exports.restrictUser = async (req, res) => {
  const user = await fraud.restrictUser(req.params.userId, req.body.hours, req.body.reason);
  if (!user) throw new HttpError(404, "User not found");
  res.json({ success: true, restrictedUntil: user.restrictedUntil });
};
exports.liftRestriction = async (req, res) => {
  const User = require("../models/User");
  const user = await User.findByIdAndUpdate(req.params.userId, { restrictedUntil: null, restrictionReason: null }, { returnDocument: "after" });
  if (!user) throw new HttpError(404, "User not found");
  res.json({ success: true, message: "Restriction lifted" });
};

// GET/PUT /api/admin/fraud/settings
exports.getFraudSettings = async (req, res) => res.json({ success: true, data: await settings.get("fraud") });
exports.updateFraudSettings = async (req, res) =>
  res.json({ success: true, data: await settings.set("fraud", req.body) });
