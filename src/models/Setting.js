const mongoose = require("mongoose");

// Generic key/value store for admin-configurable settings (surge pricing, fraud thresholds)
const settingSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Setting", settingSchema);
