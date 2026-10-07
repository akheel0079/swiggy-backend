const router = require("express").Router();
const c = require("../controllers/restaurantController");
const { searchRestaurants } = require("../controllers/searchController");
const { protect } = require("../middleware/authMiddleware");

router.get("/search", searchRestaurants);
router.get("/recommendations/:userId", protect, c.getRecommendations);
router.post("/", protect, c.createRestaurant);
router.get("/my", protect, c.getMyRestaurant);
router.put("/my", protect, c.updateRestaurant);
router.get("/", c.getAllRestaurants);

module.exports = router;
