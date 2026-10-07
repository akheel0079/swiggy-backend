const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const app = express();

app.set("trust proxy", 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "*" }));
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true }), require("./routes/authRoutes"));
app.use("/api/restaurants", require("./routes/restaurantRoute"));
app.use("/api/menu", require("./routes/menuRoute"));
app.use("/api/cart", require("./routes/cartRoutes"));
app.use("/api/orders", require("./routes/orderRoutes"));
app.use("/api/delivery", require("./routes/deliveryRoutes"));
app.use("/api/notifications", require("./routes/notificationRoutes"));
app.use("/api/admin", require("./routes/AdminRoutes"));

app.get("/", (req, res) => res.json({ success: true, message: "Welcome to Swiggy API" }));
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

app.use((req, res) => res.status(404).json({ success: false, message: "Route not found" }));
app.use((err, req, res, next) => {
  const status = err.status || (err.name === "CastError" || err.name === "ValidationError" ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ success: false, message: status === 500 ? "Server error" : err.message, ...(err.extra || {}) });
});

module.exports = app;
