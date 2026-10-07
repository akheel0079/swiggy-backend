const mongoose = require("mongoose");

const ORDER_STATUSES = [
  "Under Review", // held by fraud engine
  "Order Placed",
  "Restaurant Accepted",
  "Preparing Food",
  "Out for Delivery",
  "Delivered",
  "Cancelled",
  "Rejected",
];

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    items: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "Menu" },
        name: String,
        price: Number,
        quantity: Number,
      },
    ],
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    couponCode: { type: String },
    deliveryFee: { type: Number, default: 0 },
    surgeMultiplier: { type: Number, default: 1 },
    totalAmount: { type: Number, required: true }, // payable: subtotal - discount + deliveryFee
    paymentStatus: { type: String, enum: ["Pending", "Paid", "Failed", "Refunded"], default: "Pending" },
    orderStatus: { type: String, enum: ORDER_STATUSES, default: "Order Placed", index: true },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        note: String,
        _id: false,
      },
    ],
    deliveryAddress: { type: String, required: true },
    deliveryLocation: {
      type: { type: String, enum: ["Point"] },
      coordinates: { type: [Number], default: undefined },
    },

    // Smart delivery assignment
    deliveryPartner: { type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner", default: null },
    rejectedPartners: [{ type: mongoose.Schema.Types.ObjectId, ref: "DeliveryPartner" }],
    partnerAccepted: { type: Boolean, default: false },
    assignedAt: Date,
    estimatedDeliveryTime: Number, // minutes

    // Fraud detection
    riskScore: { type: Number, default: 0, index: true },
    riskFlags: [{ rule: String, points: Number, detail: String, _id: false }],
    fraudStatus: {
      type: String,
      enum: ["clear", "flagged", "approved", "rejected"],
      default: "clear",
      index: true,
    },
    fraudReview: {
      reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      action: String,
      note: String,
      at: Date,
    },
    cancelReason: String,
    refundRequested: { type: Boolean, default: false },
    refundReason: String,
  },
  { timestamps: true },
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ fraudStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Order", orderSchema);
module.exports.ORDER_STATUSES = ORDER_STATUSES;
