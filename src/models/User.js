const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["user", "admin", "restaurant", "delivery"],
      default: "user",
    },
    isblocked: { type: Boolean, default: false },
    // Fraud management: temporary account restriction (cannot place orders)
    restrictedUntil: { type: Date, default: null },
    restrictionReason: { type: String },
  },
  { timestamps: true },
);

userSchema.methods.isRestricted = function () {
  return !!this.restrictedUntil && this.restrictedUntil > new Date();
};

module.exports = mongoose.model("User", userSchema);
