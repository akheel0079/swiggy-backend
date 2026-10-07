const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Notification = require("../models/Notification");

let io = null;

exports.init = (httpServer, canAccessOrder) => {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_ORIGIN || "*", methods: ["GET", "POST"] },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        socket.handshake.headers?.authorization?.split(" ")[1] ||
        socket.handshake.query?.token;
      if (!token) return next(new Error("Not authorized"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user || user.isblocked) return next(new Error("Access denied"));
      socket.user = user;
      next();
    } catch (e) {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const u = socket.user;
    socket.join(`user:${u._id}`);
    if (u.role === "admin") socket.join("admins");
    socket.emit("connected", { userId: u._id, role: u.role });

    // Subscribe to live updates of a specific order (authorised)
    socket.on("order:subscribe", async (orderId, ack) => {
      try {
        const ok = await canAccessOrder(u, orderId);
        if (ok) socket.join(`order:${orderId}`);
        if (typeof ack === "function") ack({ success: !!ok });
      } catch (e) {
        if (typeof ack === "function") ack({ success: false });
      }
    });
    socket.on("order:unsubscribe", (orderId) => socket.leave(`order:${orderId}`));
  });
  return io;
};

exports.emit = (rooms, event, payload) => {
  if (!io) return;
  [].concat(rooms).forEach((r) => io.to(r).emit(event, payload));
};

// Persist + push a notification to one user
exports.notifyUser = async (userId, { order, title, message, type = "ORDER_STATUS", data = {} }) => {
  if (!userId) return;
  try {
    const n = await Notification.create({ user: userId, order, title, message, type });
    exports.emit(`user:${userId}`, "notification", { id: n._id, title, message, type, orderId: order, ...data, createdAt: n.createdAt });
  } catch (e) {
    console.error("notify error:", e.message);
  }
};

exports.orderUpdate = (order) => {
  const payload = {
    orderId: order._id,
    status: order.orderStatus,
    fraudStatus: order.fraudStatus,
    deliveryPartner: order.deliveryPartner,
    estimatedDeliveryTime: order.estimatedDeliveryTime,
    updatedAt: order.updatedAt,
  };
  exports.emit([`order:${order._id}`, `user:${order.user}`, "admins"], "order:status", payload);
};
