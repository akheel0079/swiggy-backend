const DeliveryPartner = require("../models/DeliveryPartner");
const Restaurant = require("../models/restaurant");
const Order = require("../models/order");
const { distanceKm } = require("../utils/geo");
const notify = require("./notificationService");

const AVG_SPEED_KMH = 20;
const PREP_MINUTES = 15;
const WORKLOAD_PENALTY_KM = 1.5; // each active order counts like 1.5 km extra distance
const ACTIVE_STATUSES = ["Order Placed", "Restaurant Accepted", "Preparing Food", "Out for Delivery"];

async function candidatePartners(restaurant, excluded) {
  const base = { status: "available" };
  if (excluded.length) base._id = { $nin: excluded };
  let list = [];

  // Geo query: nearest available partners to the restaurant
  if (restaurant.location?.coordinates?.length === 2) {
    try {
      list = await DeliveryPartner.aggregate([
        {
          $geoNear: {
            near: restaurant.location,
            distanceField: "distanceM",
            spherical: true,
            maxDistance: 20000,
            query: base,
          },
        },
        { $limit: 25 },
      ]);
      list = list.map((p) => ({ ...p, distanceKm: p.distanceM / 1000 }));
    } catch (e) {
      list = [];
    }
  }

  // Fallback (no geo index support / restaurant without coordinates / partners without GPS)
  if (!list.length) {
    const all = await DeliveryPartner.find(base).lean();
    list = all.map((p) => ({
      ...p,
      distanceKm: distanceKm(restaurant.location?.coordinates, p.location?.coordinates) ?? 5,
    }));
  }
  return list.filter((p) => p.activeOrders < p.maxActiveOrders);
}

/** Pick best partner (distance + workload), atomically claim, and update the order. */
exports.assignPartner = async (order) => {
  const restaurant = await Restaurant.findById(order.restaurant).lean();
  if (!restaurant) return null;
  const candidates = await candidatePartners(restaurant, order.rejectedPartners || []);
  candidates.sort(
    (a, b) => a.distanceKm + a.activeOrders * WORKLOAD_PENALTY_KM - (b.distanceKm + b.activeOrders * WORKLOAD_PENALTY_KM),
  );

  for (const c of candidates) {
    // atomic claim guards against two orders grabbing the same last slot
    const claimed = await DeliveryPartner.findOneAndUpdate(
      { _id: c._id, status: "available", activeOrders: { $lt: c.maxActiveOrders } },
      { $inc: { activeOrders: 1 } },
      { returnDocument: "after" },
    );
    if (!claimed) continue;
    if (claimed.activeOrders >= claimed.maxActiveOrders) {
      claimed.status = "busy";
      await claimed.save();
    }

    const toCustomer = distanceKm(restaurant.location?.coordinates, order.deliveryLocation?.coordinates) ?? 3;
    const eta = Math.round(
      PREP_MINUTES + ((c.distanceKm + toCustomer) / AVG_SPEED_KMH) * 60 + c.activeOrders * 5,
    );

    order.deliveryPartner = claimed._id;
    order.partnerAccepted = false;
    order.assignedAt = new Date();
    order.estimatedDeliveryTime = eta;
    await order.save();

    notify.notifyUser(claimed.user, {
      order: order._id,
      title: "New delivery assigned",
      message: `Pickup from ${restaurant.name}. Accept or decline the order.`,
      type: "DELIVERY_ASSIGNED",
    });
    notify.notifyUser(order.user, {
      order: order._id,
      title: "Delivery partner assigned",
      message: `Your order will arrive in about ${eta} minutes.`,
    });
    notify.orderUpdate(order);
    return claimed;
  }

  order.deliveryPartner = null;
  await order.save();
  return null;
};

/** Free the partner's slot (order delivered / cancelled / declined). */
exports.release = async (partnerId) => {
  if (!partnerId) return;
  const p = await DeliveryPartner.findOneAndUpdate(
    { _id: partnerId, activeOrders: { $gt: 0 } },
    { $inc: { activeOrders: -1 } },
    { returnDocument: "after" },
  );
  if (p && p.status === "busy" && p.activeOrders < p.maxActiveOrders) {
    p.status = "available";
    await p.save();
    exports.assignPending();
  }
};

/** Hand waiting (unassigned) orders to partners that just became free. */
exports.assignPending = async () => {
  const waiting = await Order.find({
    deliveryPartner: null,
    orderStatus: { $in: ACTIVE_STATUSES },
    fraudStatus: { $ne: "flagged" },
  })
    .sort({ createdAt: 1 })
    .limit(10);
  for (const o of waiting) {
    const p = await exports.assignPartner(o);
    if (!p) break;
  }
};

exports.decline = async (order, partner) => {
  order.rejectedPartners.push(partner._id);
  order.deliveryPartner = null;
  order.partnerAccepted = false;
  await order.save();
  await exports.release(partner._id);
  return exports.assignPartner(order); // automatic re-assignment
};

exports.getOrCreatePartner = async (userId) =>
  (await DeliveryPartner.findOne({ user: userId })) || DeliveryPartner.create({ user: userId });
