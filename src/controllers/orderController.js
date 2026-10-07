const mongoose = require("mongoose");
const Order = require("../models/order");
const Cart = require("../models/Cart");
const Coupon = require("../models/Coupon");
const Restaurant = require("../models/restaurant");
const DeliveryPartner = require("../models/DeliveryPartner");
const fraud = require("../services/fraudService");
const surge = require("../services/surgeService");
const delivery = require("../services/deliveryService");
const orders = require("../services/orderService");
const recommendations = require("../services/recommendationService");
const notify = require("../services/notificationService");
const { toPoint } = require("../utils/geo");
const HttpError = require("../utils/httpError");

const isId = (id) => mongoose.Types.ObjectId.isValid(id);

async function resolveCoupon(code, subtotal) {
  if (!code) return { discount: 0 };
  const coupon = await Coupon.findOne({ code: String(code).toUpperCase().trim(), isActive: true });
  if (!coupon || (coupon.expiresAt && coupon.expiresAt < new Date())) {
    throw new HttpError(400, "Invalid or expired coupon");
  }
  if (subtotal < coupon.minOrderValue) {
    throw new HttpError(400, `Minimum order value for this coupon is ₹${coupon.minOrderValue}`);
  }
  const discount = Math.min(coupon.maxDiscount, Math.round((subtotal * coupon.discountPercent) / 100));
  return { discount, code: coupon.code };
}

const loadCart = async (userId) => {
  const cart = await Cart.findOne({ user: userId }).populate("items.menuItem").populate("restaurant");
  if (!cart || cart.items.length === 0) throw new HttpError(400, "Cart is empty");
  if (!cart.restaurant.isApproved) throw new HttpError(400, "Restaurant not approved");
  const items = cart.items
    .filter((i) => i.menuItem)
    .map((i) => ({ menuItem: i.menuItem._id, name: i.menuItem.name, price: i.menuItem.price, quantity: i.quantity }));
  if (!items.length) throw new HttpError(400, "Cart items are no longer available");
  const subtotal = items.reduce((t, i) => t + i.price * i.quantity, 0);
  return { cart, items, subtotal };
};

// POST /api/orders/calculate-delivery-fee
exports.calculateDeliveryFee = async (req, res) => {
  const { restaurantId, latitude, longitude } = req.body;
  let restaurant, subtotal = Number(req.body.subtotal) || 0;
  if (restaurantId) {
    if (!isId(restaurantId)) throw new HttpError(400, "Invalid restaurantId");
    restaurant = await Restaurant.findById(restaurantId).lean();
  } else {
    const { cart, subtotal: s } = await loadCart(req.user._id);
    restaurant = cart.restaurant.toObject();
    subtotal = s;
  }
  if (!restaurant) throw new HttpError(404, "Restaurant not found");
  const deliveryLocation = toPoint(latitude, longitude);
  const result = await surge.calculate({ restaurant, deliveryLocation, subtotal });
  res.json({ success: true, data: { ...result, subtotal, total: subtotal + result.deliveryFee } });
};

// POST /api/orders/create
exports.placeOrder = async (req, res) => {
  const { deliveryAddress, couponCode, latitude, longitude } = req.body;
  if (!deliveryAddress || !String(deliveryAddress).trim()) throw new HttpError(400, "deliveryAddress is required");

  if (req.user.isRestricted()) {
    throw new HttpError(403, "Your account is temporarily restricted from placing orders", {
      restrictedUntil: req.user.restrictedUntil,
    });
  }

  const { cart, items, subtotal } = await loadCart(req.user._id);
  const { discount, code } = await resolveCoupon(couponCode, subtotal);
  const deliveryLocation = toPoint(latitude, longitude);
  const fee = await surge.calculate({ restaurant: cart.restaurant.toObject(), deliveryLocation, subtotal });
  const totalAmount = Math.max(0, subtotal - discount) + fee.deliveryFee;

  const order = new Order({
    user: req.user._id,
    restaurant: cart.restaurant._id,
    items,
    subtotal,
    discount,
    couponCode: code,
    deliveryFee: fee.deliveryFee,
    surgeMultiplier: fee.surgeMultiplier,
    totalAmount,
    deliveryAddress: String(deliveryAddress).trim(),
    deliveryLocation: deliveryLocation || undefined,
  });

  // ---- Fraud evaluation ----
  await fraud.record(req.user._id, "ORDER_CREATED", order._id, { totalAmount });
  if (code) await fraud.record(req.user._id, "COUPON_USED", order._id, { code, discount });
  const risk = await fraud.evaluate({ user: req.user, event: "create", order, couponInfo: { subtotal, discount } });
  fraud.applyToOrder(order, risk);

  if (risk.suspicious) {
    orders.pushStatus(order, "Under Review", null, `Flagged by fraud engine (score ${risk.score})`);
  } else {
    orders.pushStatus(order, "Order Placed", req.user._id);
  }
  await order.save();
  await Cart.findOneAndDelete({ user: req.user._id });

  if (risk.suspicious) {
    notify.emit("admins", "fraud:flagged", { orderId: order._id, riskScore: risk.score, flags: risk.flags });
    await orders.broadcast(order);
  } else {
    // Profile + popularity + automatic delivery partner assignment
    await Promise.all([
      recommendations.updateProfile(order),
      Restaurant.updateOne({ _id: order.restaurant }, { $inc: { orderCount: 1 } }),
    ]);
    await orders.broadcast(order, { notifyRestaurant: true });
    await delivery.assignPartner(order);
  }

  const fresh = await Order.findById(order._id).populate("deliveryPartner", "status location vehicle");
  res.status(201).json({
    success: true,
    message: risk.suspicious
      ? "Order received and is under review"
      : "Order placed successfully",
    data: fresh,
    risk: { score: risk.score, flagged: risk.suspicious },
  });
};

// POST /api/orders/cancel/:orderId
exports.cancelOrder = async (req, res) => {
  const { orderId } = req.params;
  if (!isId(orderId)) throw new HttpError(400, "Invalid order id");
  const order = await Order.findById(orderId);
  if (!order || String(order.user) !== String(req.user._id)) throw new HttpError(404, "Order not found");
  if (!["Under Review", "Order Placed", "Restaurant Accepted"].includes(order.orderStatus)) {
    throw new HttpError(400, `Order cannot be cancelled once it is ${order.orderStatus}`);
  }

  await fraud.record(req.user._id, "ORDER_CANCELLED", order._id, { reason: req.body.reason });
  order.cancelReason = req.body.reason;
  if (order.paymentStatus === "Paid") order.paymentStatus = "Refunded";

  const risk = await fraud.evaluate({ user: req.user, event: "cancel", order });
  if (risk.score > order.riskScore) {
    order.riskScore = risk.score;
    order.riskFlags = risk.flags;
  }
  if (risk.suspicious && order.fraudStatus === "clear") order.fraudStatus = "flagged";

  await orders.changeStatus(order, "Cancelled", req.user, req.body.reason);
  if (risk.suspicious) notify.emit("admins", "fraud:flagged", { orderId: order._id, riskScore: risk.score, flags: risk.flags });

  res.json({ success: true, message: "Order cancelled", data: order, risk: { score: risk.score, flagged: risk.suspicious } });
};

// POST /api/orders/refund/:orderId
exports.requestRefund = async (req, res) => {
  const order = await Order.findOne({ _id: req.params.orderId, user: req.user._id });
  if (!order) throw new HttpError(404, "Order not found");
  if (order.paymentStatus !== "Paid") throw new HttpError(400, "Only paid orders can be refunded");
  if (order.refundRequested) throw new HttpError(400, "Refund already requested");

  await fraud.record(req.user._id, "REFUND_REQUESTED", order._id, { reason: req.body.reason });
  order.refundRequested = true;
  order.refundReason = req.body.reason;
  const risk = await fraud.evaluate({ user: req.user, event: "refund", order });
  if (risk.score > order.riskScore) {
    order.riskScore = risk.score;
    order.riskFlags = risk.flags;
  }
  if (risk.suspicious && order.fraudStatus === "clear") order.fraudStatus = "flagged";
  await order.save();
  if (risk.suspicious) notify.emit("admins", "fraud:flagged", { orderId: order._id, riskScore: risk.score, flags: risk.flags });
  res.json({ success: true, message: "Refund request submitted", data: order, risk: { score: risk.score, flagged: risk.suspicious } });
};

// GET /api/orders/my
exports.getMyOrders = async (req, res) => {
  const data = await Order.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, data });
};

// GET /api/orders/restaurant
exports.getRestaurantOrders = async (req, res) => {
  const r = await Restaurant.findOne({ owner: req.user._id });
  if (!r) throw new HttpError(404, "Restaurant not found");
  const data = await Order.find({ restaurant: r._id, orderStatus: { $ne: "Under Review" } }).sort({ createdAt: -1 });
  res.json({ success: true, data });
};

// GET /api/orders/:orderId
exports.getOrder = async (req, res) => {
  const { orderId } = req.params;
  if (!isId(orderId)) throw new HttpError(400, "Invalid order id");
  if (!(await orders.canAccessOrder(req.user, orderId))) throw new HttpError(404, "Order not found");
  const order = await Order.findById(orderId)
    .populate("restaurant", "name address location avgDeliveryTime")
    .populate({ path: "deliveryPartner", select: "status location vehicle user", populate: { path: "user", select: "name" } });
  const data = order.toObject();
  if (req.user.role !== "admin") {
    delete data.riskScore;
    delete data.riskFlags;
    delete data.fraudReview;
  }
  res.json({ success: true, data });
};

// POST /api/orders/verify  (mock payment)
exports.mockPayment = async (req, res) => {
  const { orderId } = req.body;
  if (!isId(orderId)) throw new HttpError(400, "Invalid orderId");
  const order = await Order.findOne({ _id: orderId, user: req.user._id });
  if (!order) throw new HttpError(404, "Order not found");
  if (["Cancelled", "Rejected"].includes(order.orderStatus)) throw new HttpError(400, "Order is not payable");
  order.paymentStatus = "Paid";
  await order.save();
  res.json({ success: true, message: "Mock payment successful", data: { orderId: order._id, paymentStatus: order.paymentStatus } });
};

// PUT /api/orders/update-status/:orderId  (restaurant owner, assigned delivery partner, or admin)
exports.updateOrderStatus = async (req, res) => {
  const orderId = req.params.orderId || req.params.id;
  const { status } = req.body;
  if (!isId(orderId)) throw new HttpError(400, "Invalid order id");
  const order = await Order.findById(orderId);
  if (!order) throw new HttpError(404, "Order not found");

  const allowed = TRANSITIONS_FOR(order.orderStatus);
  if (!allowed.includes(status)) {
    throw new HttpError(400, `Cannot move order from "${order.orderStatus}" to "${status}"`, { allowedNext: allowed });
  }

  const role = req.user.role;
  if (role === "restaurant") {
    const r = await Restaurant.findOne({ owner: req.user._id });
    if (!r || String(r._id) !== String(order.restaurant)) throw new HttpError(403, "Not authorized");
  } else if (role === "delivery") {
    const p = await DeliveryPartner.findOne({ user: req.user._id });
    if (!p || String(order.deliveryPartner) !== String(p._id)) throw new HttpError(403, "Not authorized");
    if (!["Out for Delivery", "Delivered"].includes(status)) throw new HttpError(403, "Delivery partners can only set Out for Delivery / Delivered");
  } else if (role !== "admin") {
    throw new HttpError(403, "Forbidden");
  }

  await orders.changeStatus(order, status, req.user);
  res.json({ success: true, message: "Order status updated", data: order });
};

function TRANSITIONS_FOR(current) {
  return orders.TRANSITIONS[current] || [];
}
