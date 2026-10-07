const DeliveryPartner = require("../models/DeliveryPartner");
const Order = require("../models/order");
const delivery = require("../services/deliveryService");
const { toPoint } = require("../utils/geo");
const HttpError = require("../utils/httpError");

// POST /api/delivery/set-status  { status: available|offline, latitude, longitude }
exports.setStatus = async (req, res) => {
  const { status, latitude, longitude } = req.body;
  if (!["available", "offline"].includes(status)) throw new HttpError(400, "status must be 'available' or 'offline'");
  const p = await delivery.getOrCreatePartner(req.user._id);
  const point = toPoint(latitude, longitude);
  if (point) { p.location = point; p.lastLocationAt = new Date(); }
  p.status = status === "available" && p.activeOrders >= p.maxActiveOrders ? "busy" : status;
  await p.save();
  if (p.status === "available") delivery.assignPending();
  res.json({ success: true, data: p });
};

const myOrder = async (req) => {
  const p = await DeliveryPartner.findOne({ user: req.user._id });
  const order = p && (await Order.findOne({ _id: req.params.orderId, deliveryPartner: p._id }));
  if (!order) throw new HttpError(404, "Order not assigned to you");
  return { p, order };
};

exports.accept = async (req, res) => {
  const { order } = await myOrder(req);
  order.partnerAccepted = true;
  await order.save();
  res.json({ success: true, data: order });
};

// POST /api/delivery/orders/:orderId/decline -> automatic reassignment
exports.decline = async (req, res) => {
  const { p, order } = await myOrder(req);
  if (["Out for Delivery", "Delivered"].includes(order.orderStatus)) throw new HttpError(400, "Cannot decline now");
  const next = await delivery.decline(order, p);
  res.json({ success: true, message: next ? "Order reassigned" : "Declined; waiting for another partner", reassignedTo: next?._id || null });
};

exports.myOrders = async (req, res) => {
  const p = await DeliveryPartner.findOne({ user: req.user._id });
  const data = p ? await Order.find({ deliveryPartner: p._id, orderStatus: { $nin: ["Delivered", "Cancelled", "Rejected"] } }) : [];
  res.json({ success: true, partner: p, data });
};
