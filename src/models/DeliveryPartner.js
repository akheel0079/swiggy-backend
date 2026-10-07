const mongoose = require("mongoose");

const deliveryPartnerSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    status: { type: String, enum: ["available", "busy", "offline"], default: "offline", index: true },
    activeOrders: { type: Number, default: 0, min: 0 },
    maxActiveOrders: { type: Number, default: 3 },
    vehicle: { type: String, default: "bike" },
    location: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined }, // [lng, lat]
    },
    lastLocationAt: Date,
  },
  { timestamps: true },
);

deliveryPartnerSchema.index({ location: "2dsphere" });
deliveryPartnerSchema.index({ status: 1, activeOrders: 1 });

module.exports = mongoose.model("DeliveryPartner", deliveryPartnerSchema);
