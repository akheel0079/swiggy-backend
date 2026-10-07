const mongoose = require("mongoose");

// Records user behaviour used by the fraud engine
const behaviorLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: {
      type: String,
      enum: ["ORDER_CREATED", "ORDER_CANCELLED", "COUPON_USED", "REFUND_REQUESTED"],
      required: true,
    },
    order: { type: mongoose.Schema.Types.ObjectId, ref: "Order" },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

behaviorLogSchema.index({ user: 1, type: 1, createdAt: -1 });
behaviorLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 }); // keep 90 days

module.exports = mongoose.model("BehaviorLog", behaviorLogSchema);
