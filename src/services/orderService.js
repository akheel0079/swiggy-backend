const Order = require("../models/order");
const Restaurant = require("../models/restaurant");
const DeliveryPartner = require("../models/DeliveryPartner");
const notify = require("./notificationService");
const delivery = require("./deliveryService");

// Allowed lifecycle transitions
const TRANSITIONS = {
  "Order Placed": ["Restaurant Accepted", "Rejected"],
  "Restaurant Accepted": ["Preparing Food", "Rejected"],
  "Preparing Food": ["Out for Delivery"],
  "Out for Delivery": ["Delivered"],
};
const MESSAGES = {
  "Order Placed": "Your order has been placed.",
  "Restaurant Accepted": "The restaurant accepted your order.",
  "Preparing Food": "Your food is being prepared.",
  "Out for Delivery": "Your order is out for delivery.",
  Delivered: "Your order was delivered. Enjoy your meal!",
  Cancelled: "Your order was cancelled.",
  Rejected: "Sorry, your order was rejected.",
  "Under Review": "Your order is under review.",
};
exports.TRANSITIONS = TRANSITIONS;

exports.pushStatus = (order, status, by, note) => {
  order.orderStatus = status;
  order.statusHistory.push({ status, by, note });
};

// Persist, then fan-out real-time events + stored notifications
exports.broadcast = async (order, { notifyRestaurant = false } = {}) => {
  notify.orderUpdate(order);
  await notify.notifyUser(order.user, {
    order: order._id,
    title: `Order ${order.orderStatus}`,
    message: MESSAGES[order.orderStatus] || order.orderStatus,
    data: { status: order.orderStatus },
  });
  if (notifyRestaurant) {
    const r = await Restaurant.findById(order.restaurant).select("owner").lean();
    if (r) {
      await notify.notifyUser(r.owner, {
        order: order._id,
        title: `Order ${order.orderStatus}`,
        message: `Order ${String(order._id).slice(-6)} is now ${order.orderStatus}.`,
        type: "ORDER_STATUS",
      });
    }
  }
};

exports.changeStatus = async (order, status, actor, note) => {
  exports.pushStatus(order, status, actor?._id, note);
  await order.save();
  if (["Delivered", "Cancelled", "Rejected"].includes(status) && order.deliveryPartner) {
    await delivery.release(order.deliveryPartner);
  }
  await exports.broadcast(order, { notifyRestaurant: ["Cancelled"].includes(status) });
  return order;
};

// Who may view / follow an order
exports.canAccessOrder = async (user, orderId) => {
  const order = await Order.findById(orderId).select("user restaurant deliveryPartner").lean();
  if (!order) return false;
  if (user.role === "admin" || String(order.user) === String(user._id)) return true;
  if (user.role === "restaurant") {
    const r = await Restaurant.findOne({ _id: order.restaurant, owner: user._id }).select("_id").lean();
    return !!r;
  }
  if (user.role === "delivery" && order.deliveryPartner) {
    const p = await DeliveryPartner.findOne({ _id: order.deliveryPartner, user: user._id }).select("_id").lean();
    return !!p;
  }
  return false;
};
