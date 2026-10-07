const router = require("express").Router();
const { protect, authorize } = require("../middleware/authMiddleware");
const c = require("../controllers/orderController");

router.use(protect);
router.post("/calculate-delivery-fee", authorize("user"), c.calculateDeliveryFee);
router.post("/create", authorize("user"), c.placeOrder);
router.post("/", authorize("user"), c.placeOrder); // backward compatible
router.post("/cancel/:orderId", authorize("user"), c.cancelOrder);
router.post("/refund/:orderId", authorize("user"), c.requestRefund);
router.post("/verify", authorize("user"), c.mockPayment);
router.get("/my", authorize("user"), c.getMyOrders);
router.get("/restaurant", authorize("restaurant"), c.getRestaurantOrders);
router.put("/update-status/:orderId", authorize("restaurant", "delivery", "admin"), c.updateOrderStatus);
router.put("/:id/status", authorize("restaurant", "delivery", "admin"), c.updateOrderStatus); // backward compatible
router.get("/:orderId", c.getOrder);

module.exports = router;
