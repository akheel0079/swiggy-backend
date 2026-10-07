const router = require("express").Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const c = require("../controllers/deliveryController");
router.use(protect, authorize("delivery"));
router.post("/set-status", c.setStatus);
router.get("/my-orders", c.myOrders);
router.post("/orders/:orderId/accept", c.accept);
router.post("/orders/:orderId/decline", c.decline);
module.exports = router;
