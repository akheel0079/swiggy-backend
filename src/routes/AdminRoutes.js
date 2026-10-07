const router = require("express").Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const a = require("../controllers/AdminController");
const f = require("../controllers/fraudController");
const s = require("../controllers/surgeController");
const r = require("../controllers/restaurantController");
const Coupon = require("../models/Coupon");

router.use(protect, authorize("admin"));
router.get("/", a.getallUsers);
router.put("/users/:id/block", a.toggleBlockUser);
router.put("/restaurant/:id/approve", a.approveRestaurant);
router.get("/statistics", a.getPlatformStatistics);
router.get("/orders", a.getAllOrders);

router.get("/fraud/orders", f.getFraudOrders);
router.put("/fraud/orders/:orderId", f.reviewOrder);
router.get("/fraud/settings", f.getFraudSettings);
router.put("/fraud/settings", f.updateFraudSettings);
router.post("/fraud/users/:userId/restrict", f.restrictUser);
router.delete("/fraud/users/:userId/restrict", f.liftRestriction);

router.get("/surge-settings", s.getSurgeSettings);
router.put("/surge-settings", s.updateSurgeSettings);
router.post("/surge-settings/reset", s.resetSurgeSettings);

router.post("/restaurants/create", r.adminCreate);
router.put("/restaurants/update/:restaurantId", r.adminUpdate);

router.post("/coupons", async (req, res) => res.status(201).json({ success: true, data: await Coupon.create(req.body) }));
router.get("/coupons", async (req, res) => res.json({ success: true, data: await Coupon.find() }));

module.exports = router;
