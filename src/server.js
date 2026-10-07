require("dotenv").config();
const http = require("http");
const bcrypt = require("bcrypt");
const app = require("./app");
const connectDB = require("./config/db");
const notify = require("./services/notificationService");
const orders = require("./services/orderService");
const User = require("./models/User");

const PORT = process.env.PORT || 5000;

async function ensureAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  if (await User.findOne({ email: ADMIN_EMAIL.toLowerCase() })) return;
  await User.create({ name: "Super Admin", email: ADMIN_EMAIL, password: await bcrypt.hash(ADMIN_PASSWORD, 10), role: "admin" });
  console.log("Admin account created:", ADMIN_EMAIL);
}

(async () => {
  if (!process.env.JWT_SECRET) { console.error("JWT_SECRET is required"); process.exit(1); }
  await connectDB();
  await ensureAdmin();
  const server = http.createServer(app);
  notify.init(server, orders.canAccessOrder);
  server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
})();
