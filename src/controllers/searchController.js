const Restaurant = require("../models/restaurant");
const { normalize, buildSearchGrams, escapeRegex } = require("../utils/fuzzy");
const HttpError = require("../utils/httpError");

const SORTS = {
  relevance: { relevance: -1, rating: -1, orderCount: -1 },
  rating: { rating: -1, orderCount: -1 },
  popularity: { orderCount: -1, rating: -1 },
  deliveryTime: { avgDeliveryTime: 1, rating: -1 },
  priceLow: { priceForTwo: 1 },
  priceHigh: { priceForTwo: -1 },
};
const bool = (v) => v === true || v === "true" || v === "1";

/**
 * GET /api/restaurants/search
 * q (fuzzy), cuisine (comma list), rating (min), minPrice, maxPrice (cost for two), priceRange (1-4),
 * maxDeliveryTime (minutes), veg=true (veg options), pureVeg=true, city, sortBy, page, limit
 */
exports.searchRestaurants = async (req, res) => {
  const { q, cuisine, rating, minPrice, maxPrice, priceRange, maxDeliveryTime, veg, pureVeg, city } = req.query;
  const sortBy = SORTS[req.query.sortBy] ? req.query.sortBy : q ? "relevance" : "popularity";
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));

  const match = { isApproved: true };
  if (city) match.city = new RegExp(`^${escapeRegex(String(city).trim())}$`, "i");
  if (cuisine) {
    const list = String(cuisine).split(",").map((c) => c.trim()).filter(Boolean);
    match.cuisines = { $in: list.map((c) => new RegExp(`^${escapeRegex(c)}$`, "i")) };
  }
  if (rating !== undefined) {
    if (isNaN(Number(rating))) throw new HttpError(400, "rating must be a number");
    match.rating = { $gte: Number(rating) };
  }
  if (minPrice !== undefined || maxPrice !== undefined) {
    match.priceForTwo = {};
    if (minPrice !== undefined) match.priceForTwo.$gte = Number(minPrice);
    if (maxPrice !== undefined) match.priceForTwo.$lte = Number(maxPrice);
  }
  if (priceRange) match.priceRange = Number(priceRange);
  if (maxDeliveryTime !== undefined) match.avgDeliveryTime = { $lte: Number(maxDeliveryTime) };
  if (bool(veg)) match.hasVegOptions = true;
  if (bool(pureVeg)) match.isPureVeg = true;

  const pipeline = [];
  const query = q ? normalize(q) : "";

  if (query) {
    const qGrams = buildSearchGrams([query]);
    const prefix = `^${escapeRegex(query).split(" ").join(".*")}`;
    // Candidate retrieval uses the multikey searchGrams index
    pipeline.push({ $match: { ...match, searchGrams: { $in: qGrams } } });
    pipeline.push({
      $addFields: {
        gramOverlap: { $size: { $setIntersection: ["$searchGrams", qGrams] } },
        partialMatch: {
          $or: [
            { $regexMatch: { input: { $toLower: "$name" }, regex: escapeRegex(query) } },
            { $regexMatch: { input: { $toLower: "$name" }, regex: prefix } },
            {
              $anyElementTrue: {
                $map: {
                  input: { $ifNull: ["$cuisines", []] },
                  as: "c",
                  in: { $regexMatch: { input: { $toLower: "$$c" }, regex: escapeRegex(query) } },
                },
              },
            },
          ],
        },
      },
    });
    // similarity = share of the query's trigrams found in the restaurant ("pizzza" ~ "pizza")
    const minSim = query.length < 4 ? 0.8 : 0.55;
    pipeline.push({
      $addFields: {
        similarity: { $divide: ["$gramOverlap", qGrams.length] },
      },
    });
    pipeline.push({ $match: { $or: [{ partialMatch: true }, { similarity: { $gte: minSim } }] } });
    pipeline.push({
      $addFields: {
        relevance: { $add: ["$similarity", { $cond: ["$partialMatch", 1, 0] }] },
      },
    });
  } else {
    pipeline.push({ $match: match });
  }

  pipeline.push({ $sort: SORTS[sortBy] && sortBy === "relevance" && !query ? SORTS.popularity : SORTS[sortBy] });
  pipeline.push({
    $facet: {
      data: [
        { $skip: (page - 1) * limit },
        { $limit: limit },
        { $project: { searchGrams: 0, gramOverlap: 0, partialMatch: 0, __v: 0 } },
      ],
      total: [{ $count: "count" }],
      cuisines: [{ $unwind: "$cuisines" }, { $group: { _id: "$cuisines", count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 15 }],
    },
  });

  const [out] = await Restaurant.aggregate(pipeline);
  const total = out.total[0]?.count || 0;
  res.json({
    success: true,
    count: out.data.length,
    total,
    page,
    pages: Math.ceil(total / limit),
    sortBy,
    facets: { cuisines: out.cuisines.map((c) => ({ cuisine: c._id, count: c.count })) },
    data: out.data,
  });
};
