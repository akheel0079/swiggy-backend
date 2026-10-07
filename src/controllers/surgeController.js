const settings = require("../services/settingsService");
const HttpError = require("../utils/httpError");

const validate = (b) => {
  const num = (v, name, min = 0) => {
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < min)) {
      throw new HttpError(400, `${name} must be a number >= ${min}`);
    }
  };
  num(b.baseFee, "baseFee");
  num(b.perKmFee, "perKmFee");
  num(b.freeDeliveryAbove, "freeDeliveryAbove");
  num(b.maxMultiplier, "maxMultiplier", 1);
  if (b.enabled !== undefined && typeof b.enabled !== "boolean") throw new HttpError(400, "enabled must be boolean");
  if (b.peakHours !== undefined) {
    if (!Array.isArray(b.peakHours)) throw new HttpError(400, "peakHours must be an array");
    b.peakHours.forEach((p) => {
      if (!(p.start >= 0 && p.start <= 24 && p.end >= 0 && p.end <= 24)) throw new HttpError(400, "peakHours start/end must be 0-24");
      if (!(p.multiplier >= 1)) throw new HttpError(400, "peakHours multiplier must be >= 1");
    });
  }
};

// GET /api/admin/surge-settings
exports.getSurgeSettings = async (req, res) => res.json({ success: true, data: await settings.get("surge") });

// PUT /api/admin/surge-settings
exports.updateSurgeSettings = async (req, res) => {
  validate(req.body);
  res.json({ success: true, message: "Surge settings updated", data: await settings.set("surge", req.body) });
};

// POST /api/admin/surge-settings/reset
exports.resetSurgeSettings = async (req, res) => {
  const Setting = require("../models/Setting");
  await Setting.deleteOne({ key: "surge" });
  res.json({ success: true, data: await settings.get("surge") });
};
