const mongoose = require("mongoose");

// Preference profile updated on every order — feeds the recommendation engine
const userPreferenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    totalOrders: { type: Number, default: 0 },
    cuisineCounts: { type: Map, of: Number, default: {} },
    restaurantCounts: { type: Map, of: Number, default: {} },
    itemCounts: { type: Map, of: Number, default: {} },
    lastOrderAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("UserPreference", userPreferenceSchema);
