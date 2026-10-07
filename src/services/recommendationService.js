const mongoose = require("mongoose");
const Order = require("../models/order");
const Restaurant = require("../models/restaurant");
const UserPreference = require("../models/UserPreference");

const key = (s) => String(s).replace(/[.$]/g, "_");

/** Update the preference profile every time an order is placed. */
exports.updateProfile = async (order) => {
  const restaurant = await Restaurant.findById(order.restaurant).lean();
  const inc = { totalOrders: 1, [`restaurantCounts.${order.restaurant}`]: 1 };
  (restaurant?.cuisines || []).forEach((c) => {
    inc[`cuisineCounts.${key(c)}`] = (inc[`cuisineCounts.${key(c)}`] || 0) + 1;
  });
  order.items.forEach((i) => {
    inc[`itemCounts.${key(i.name)}`] = (inc[`itemCounts.${key(i.name)}`] || 0) + i.quantity;
  });
  await UserPreference.findOneAndUpdate(
    { user: order.user },
    { $inc: inc, $set: { lastOrderAt: new Date() } },
    { upsert: true },
  );
};

const VALID = { $nin: ["Cancelled", "Rejected", "Under Review"] };

/** History analysis via aggregation pipelines */
const analyseHistory = async (userId) => {
  const match = { $match: { user: new mongoose.Types.ObjectId(userId), orderStatus: VALID } };

  const [cuisines, restaurants, items] = await Promise.all([
    Order.aggregate([
      match,
      { $lookup: { from: "restaurants", localField: "restaurant", foreignField: "_id", as: "r" } },
      { $unwind: "$r" },
      { $unwind: "$r.cuisines" },
      { $group: { _id: "$r.cuisines", orders: { $sum: 1 } } },
      { $sort: { orders: -1 } },
    ]),
    Order.aggregate([match, { $group: { _id: "$restaurant", orders: { $sum: 1 }, lastOrder: { $max: "$createdAt" } } }]),
    Order.aggregate([
      match,
      { $unwind: "$items" },
      { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" } } },
      { $sort: { quantity: -1 } },
      { $limit: 5 },
    ]),
  ]);
  return { cuisines, restaurants, items };
};

exports.recommend = async (userId, { limit = 10, city } = {}) => {
  const { cuisines, restaurants, items } = await analyseHistory(userId);

  const maxCuisine = cuisines[0]?.orders || 1;
  const maxRestaurant = Math.max(1, ...restaurants.map((r) => r.orders));
  const topOrdered = await Restaurant.findOne({ isApproved: true }).sort({ orderCount: -1 }).select("orderCount").lean();
  const maxPopularity = Math.max(1, topOrdered?.orderCount || 1);

  const cuisineKeys = cuisines.map((c) => c._id);
  const cuisineWeights = cuisines.map((c) => c.orders / maxCuisine);
  const restKeys = restaurants.map((r) => r._id);
  const restWeights = restaurants.map((r) => r.orders / maxRestaurant);
  const hasHistory = cuisines.length > 0;

  // weights: with history personalise; cold-start falls back to rating + popularity
  const W = hasHistory
    ? { cuisine: 0.4, rating: 0.25, popularity: 0.2, affinity: 0.15 }
    : { cuisine: 0, rating: 0.55, popularity: 0.45, affinity: 0 };

  const matchStage = { isApproved: true };
  if (city) matchStage.city = city;

  const pipeline = [
    { $match: matchStage },
    {
      $addFields: {
        cuisineMatches: { $setIntersection: [{ $ifNull: ["$cuisines", []] }, cuisineKeys] },
        cuisineSimilarity: {
          $cond: [
            { $eq: [{ $size: { $ifNull: ["$cuisines", []] } }, 0] },
            0,
            {
              $min: [
                1,
                {
                  $sum: {
                    $map: {
                      input: { $ifNull: ["$cuisines", []] },
                      as: "c",
                      in: {
                        $let: {
                          vars: { idx: { $indexOfArray: [cuisineKeys, "$$c"] } },
                          in: { $cond: [{ $gte: ["$$idx", 0] }, { $arrayElemAt: [cuisineWeights, "$$idx"] }, 0] },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
        restaurantAffinity: {
          $let: {
            vars: { idx: { $indexOfArray: [restKeys, "$_id"] } },
            in: { $cond: [{ $gte: ["$$idx", 0] }, { $arrayElemAt: [restWeights, "$$idx"] }, 0] },
          },
        },
        ratingScore: { $divide: [{ $ifNull: ["$rating", 0] }, 5] },
        popularityScore: {
          $divide: [{ $ln: { $add: [1, { $ifNull: ["$orderCount", 0] }] } }, Math.log(1 + maxPopularity)],
        },
      },
    },
    {
      $addFields: {
        recommendationScore: {
          $round: [
            {
              $multiply: [
                100,
                {
                  $add: [
                    { $multiply: [W.cuisine, "$cuisineSimilarity"] },
                    { $multiply: [W.rating, "$ratingScore"] },
                    { $multiply: [W.popularity, "$popularityScore"] },
                    { $multiply: [W.affinity, "$restaurantAffinity"] },
                  ],
                },
              ],
            },
            1,
          ],
        },
      },
    },
    { $sort: { recommendationScore: -1, rating: -1 } },
    { $limit: Math.min(50, Math.max(1, Number(limit))) },
    {
      $project: {
        name: 1, city: 1, address: 1, image: 1, cuisines: 1, rating: 1, priceForTwo: 1,
        avgDeliveryTime: 1, hasVegOptions: 1, orderCount: 1,
        recommendationScore: 1, cuisineMatches: 1, previouslyOrdered: { $gt: ["$restaurantAffinity", 0] },
      },
    },
  ];

  const data = await Restaurant.aggregate(pipeline);
  return {
    personalised: hasHistory,
    profile: {
      topCuisines: cuisines.slice(0, 5).map((c) => ({ cuisine: c._id, orders: c.orders })),
      frequentItems: items.map((i) => ({ item: i._id, quantity: i.quantity })),
    },
    data,
  };
};
