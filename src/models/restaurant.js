const mongoose = require("mongoose");
const { buildSearchGrams } = require("../utils/fuzzy");

const restaurantSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    city: { type: String, required: true },
    address: { type: String, required: true },
    description: { type: String },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    image: { type: String },
    cuisines: { type: [String], default: [] },
    priceForTwo: { type: Number, default: 0, min: 0 },
    priceRange: { type: Number, min: 1, max: 4, default: 2 }, // 1 = ₹, 4 = ₹₹₹₹
    avgDeliveryTime: { type: Number, default: 30, min: 0 }, // minutes
    hasVegOptions: { type: Boolean, default: false },
    isPureVeg: { type: Boolean, default: false },
    orderCount: { type: Number, default: 0 }, // popularity signal
    isApproved: { type: Boolean, default: false },
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    searchGrams: { type: [String], default: [], select: false },
  },
  { timestamps: true },
);

restaurantSchema.pre("save", function () {
  if (this.isPureVeg) this.hasVegOptions = true;
  if (this.isModified("name") || this.isModified("cuisines") || this.isNew) {
    this.searchGrams = buildSearchGrams([this.name, ...(this.cuisines || [])]);
  }
  if (!this.location || !this.location.coordinates || this.location.coordinates.length !== 2) {
    this.location = undefined;
  }
});

// Indexes for search / filtering / geo
restaurantSchema.index({ isApproved: 1, city: 1, rating: -1 });
restaurantSchema.index({ isApproved: 1, cuisines: 1, rating: -1 });
restaurantSchema.index({ isApproved: 1, orderCount: -1 });
restaurantSchema.index({ searchGrams: 1 });
restaurantSchema.index({ name: "text", cuisines: "text", description: "text" });
restaurantSchema.index({ location: "2dsphere" });

module.exports = mongoose.model("Restaurant", restaurantSchema);
