const Restaurant = require("../models/restaurant");
const recommendations = require("../services/recommendationService");
const { toPoint } = require("../utils/geo");
const HttpError = require("../utils/httpError");

const FIELDS = ["name", "city", "address", "description", "image", "cuisines", "priceForTwo", "priceRange",
  "avgDeliveryTime", "hasVegOptions", "isPureVeg"];
const pick = (b) => {
  const o = {};
  FIELDS.forEach((f) => b[f] !== undefined && (o[f] = b[f]));
  if (typeof o.cuisines === "string") o.cuisines = o.cuisines.split(",").map((s) => s.trim()).filter(Boolean);
  const p = toPoint(b.latitude, b.longitude);
  if (p) o.location = p;
  return o;
};
exports.pickRestaurantFields = pick;

exports.createRestaurant = async (req, res) => {
  if (req.user.role !== "restaurant") throw new HttpError(403, "Only restaurant owners can create restaurants");
  if (await Restaurant.findOne({ owner: req.user._id })) throw new HttpError(400, "You already have a restaurant registered");
  const data = await Restaurant.create({ ...pick(req.body), owner: req.user._id });
  res.status(201).json({ success: true, message: "Restaurant created successfully", data });
};

exports.getMyRestaurant = async (req, res) => {
  const data = await Restaurant.findOne({ owner: req.user._id });
  if (!data) throw new HttpError(404, "You don't have a restaurant registered");
  res.json({ success: true, data });
};

exports.updateRestaurant = async (req, res) => {
  const r = await Restaurant.findOne({ owner: req.user._id });
  if (!r) throw new HttpError(404, "You don't have a restaurant registered");
  r.set(pick(req.body));
  await r.save();
  res.json({ success: true, message: "Restaurant updated successfully", data: r });
};

exports.getAllRestaurants = async (req, res) => {
  const { city } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 10);
  const query = { isApproved: true };
  if (city) query.city = city;
  const data = await Restaurant.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit);
  res.json({ success: true, data });
};

// GET /api/restaurants/recommendations/:userId
exports.getRecommendations = async (req, res) => {
  const { userId } = req.params;
  if (req.user.role !== "admin" && String(req.user._id) !== userId) throw new HttpError(403, "Forbidden");
  const result = await recommendations.recommend(userId, { limit: req.query.limit, city: req.query.city });
  res.json({ success: true, ...result });
};

// Admin: POST /api/admin/restaurants/create , PUT /api/admin/restaurants/update/:restaurantId
exports.adminCreate = async (req, res) => {
  const data = await Restaurant.create({
    ...pick(req.body),
    owner: req.body.ownerId || req.user._id,
    isApproved: req.body.isApproved !== false,
    ...(req.body.rating !== undefined && { rating: req.body.rating }),
  });
  res.status(201).json({ success: true, message: "Restaurant created", data });
};
exports.adminUpdate = async (req, res) => {
  const r = await Restaurant.findById(req.params.restaurantId);
  if (!r) throw new HttpError(404, "Restaurant not found");
  r.set(pick(req.body));
  ["isApproved", "rating", "ratingCount"].forEach((f) => req.body[f] !== undefined && r.set(f, req.body[f]));
  await r.save();
  res.json({ success: true, message: "Restaurant updated", data: r });
};
