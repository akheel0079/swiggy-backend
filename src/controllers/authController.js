const User = require("../models/User");
const DeliveryPartner = require("../models/DeliveryPartner");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

exports.register = async (req, res) => {
  const { name, email, password } = req.body;
  const role = ["user", "restaurant", "delivery"].includes(req.body.role) ? req.body.role : "user"; // never admin
  if (!name || !email || !password || String(password).length < 6)
    return res.status(400).json({ success: false, message: "name, email and password (min 6 chars) are required" });
  if (await User.findOne({ email: String(email).toLowerCase() }))
    return res.status(400).json({ success: false, message: "User already exists" });
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10), role });
  if (role === "delivery") await DeliveryPartner.create({ user: user._id });
  res.status(201).json({ success: true, message: "User registered successfully", data: { id: user._id, role } });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email: String(email || "").toLowerCase() }).select("+password");
  if (!user || !(await bcrypt.compare(String(password || ""), user.password)))
    return res.status(400).json({ success: false, message: "Invalid credentials" });
  if (user.isblocked) return res.status(403).json({ success: false, message: "User is blocked" });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "1d" });
  res.status(200).json({
    success: true, message: "User logged in successfully", token,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
};
