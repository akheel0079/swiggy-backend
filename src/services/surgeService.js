const Order = require("../models/order");
const Restaurant = require("../models/restaurant");
const settings = require("./settingsService");
const { distanceKm } = require("../utils/geo");

const localHour = (date, offsetMinutes) => {
  const mins = (date.getUTCHours() * 60 + date.getUTCMinutes() + offsetMinutes + 1440) % 1440;
  return mins / 60;
};
const inWindow = (h, start, end) => (start <= end ? h >= start && h < end : h >= start || h < end);

/**
 * Delivery fee = (baseFee + perKm * distance) * surgeMultiplier
 * surgeMultiplier = peak-hour multiplier * demand multiplier (capped by admin setting)
 */
exports.calculate = async ({ restaurant, deliveryLocation, subtotal = 0, now = new Date() }) => {
  const cfg = await settings.get("surge");

  const distance =
    restaurant.location && deliveryLocation
      ? distanceKm(restaurant.location.coordinates, deliveryLocation.coordinates)
      : null;

  let peakMultiplier = 1;
  let peakLabel = null;
  let demandMultiplier = 1;
  let recentOrders = 0;

  if (cfg.enabled) {
    const h = localHour(now, cfg.utcOffsetMinutes);
    const peak = cfg.peakHours
      .filter((p) => inWindow(h, p.start, p.end))
      .sort((a, b) => b.multiplier - a.multiplier)[0];
    if (peak) {
      peakMultiplier = peak.multiplier;
      peakLabel = peak.label;
    }

    // Demand in the same region (city) during the rolling window
    const ids = await Restaurant.find({ city: restaurant.city }).distinct("_id");
    recentOrders = await Order.countDocuments({
      restaurant: { $in: ids },
      createdAt: { $gte: new Date(now.getTime() - cfg.demand.windowMinutes * 60000) },
      orderStatus: { $nin: ["Cancelled", "Rejected"] },
    });
    const excess = Math.max(0, recentOrders - cfg.demand.ordersThreshold);
    demandMultiplier = 1 + excess * cfg.demand.stepPerOrder;
  }

  const surgeMultiplier = Math.min(cfg.maxMultiplier, +(peakMultiplier * demandMultiplier).toFixed(2));
  const baseFee = cfg.baseFee + (distance ? cfg.perKmFee * distance : 0);
  let deliveryFee = Math.round(baseFee * surgeMultiplier);
  let freeDelivery = false;
  if (cfg.freeDeliveryAbove > 0 && subtotal >= cfg.freeDeliveryAbove) {
    deliveryFee = 0;
    freeDelivery = true;
  }

  return {
    deliveryFee,
    surgeMultiplier,
    surgeActive: surgeMultiplier > 1,
    freeDelivery,
    breakdown: {
      baseFee: cfg.baseFee,
      distanceKm: distance === null ? null : +distance.toFixed(2),
      distanceFee: distance ? Math.round(cfg.perKmFee * distance) : 0,
      peakMultiplier,
      peakLabel,
      demandMultiplier: +demandMultiplier.toFixed(2),
      recentRegionOrders: recentOrders,
      maxMultiplier: cfg.maxMultiplier,
    },
  };
};
