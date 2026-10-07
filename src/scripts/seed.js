require("dotenv").config();
const bcrypt = require("bcrypt");
const connectDB = require("../config/db");
const User = require("../models/User");
const Restaurant = require("../models/restaurant");
const Menu = require("../models/Menu");
const Coupon = require("../models/Coupon");
const DeliveryPartner = require("../models/DeliveryPartner");

(async () => {
  await connectDB();
  const mk = async (name, email, role, pw = "123456") =>
    (await User.findOne({ email })) || User.create({ name, email, role, password: await bcrypt.hash(pw, 10) });
  const admin = await mk("Super Admin", process.env.ADMIN_EMAIL || "admin@swiggy.com", "admin", process.env.ADMIN_PASSWORD || "Admin@12345");
  await mk("Rahul Sharma", "rahul@test.com", "user");
  await mk("Priya Mehta", "priya@test.com", "user");
  const o1 = await mk("Amit Restaurant", "amit@pizza.com", "restaurant");
  const o2 = await mk("Ravi Burgers", "ravi@burger.com", "restaurant");
  const o3 = await mk("Lakshmi Meals", "lakshmi@meals.com", "restaurant");

  const defs = [
    [o1, "Pizza Palace", ["Italian", "Pizza"], 4.4, 600, 3, 28, false, [77.6, 12.97], [["Veg Margherita", 299, true], ["Farmhouse Pizza", 399, true], ["Chicken Pizza", 449, false]]],
    [o2, "Burger Hub", ["American", "Burgers", "Fast Food"], 4.1, 400, 2, 22, false, [77.64, 12.98], [["Classic Burger", 199, false], ["Veg Burger", 159, true], ["Fries", 99, true]]],
    [o3, "Lakshmi Meals", ["South Indian", "Indian"], 4.6, 300, 1, 25, true, [77.59, 12.93], [["Masala Dosa", 90, true], ["Full Meals", 160, true], ["Filter Coffee", 40, true]]],
  ];
  for (const [owner, name, cuisines, rating, priceForTwo, priceRange, avgDeliveryTime, pure, c, items] of defs) {
    let r = await Restaurant.findOne({ name });
    if (!r) {
      r = await Restaurant.create({ name, owner: owner._id, city: "Bangalore", address: `${name}, Bangalore`, cuisines, rating, priceForTwo,
        priceRange, avgDeliveryTime, isPureVeg: pure, hasVegOptions: true, isApproved: true, location: { type: "Point", coordinates: c } });
      await Menu.insertMany(items.map(([n, price, isVeg]) => ({ restaurant: r._id, name: n, price, isVeg, category: cuisines[0] })));
    }
  }
  for (const [i, c] of [[1, [77.601, 12.972]], [2, [77.638, 12.979]], [3, [77.592, 12.931]]]) {
    const u = await mk(`Partner ${i}`, `partner${i}@test.com`, "delivery");
    await DeliveryPartner.findOneAndUpdate({ user: u._id }, { status: "available", location: { type: "Point", coordinates: c } }, { upsert: true });
  }
  for (const [code, discountPercent] of [["WELCOME20", 20], ["MEGA60", 60]])
    await Coupon.findOneAndUpdate({ code }, { code, discountPercent, maxDiscount: 300 }, { upsert: true });
  console.log("Seed complete. Admin:", admin.email);
  process.exit(0);
})();
