const router = require("express").Router();
const { protect } = require("../middleware/authMiddleware");
const c = require("../controllers/notificationController");
router.use(protect);
router.get("/", c.list);
router.put("/read", c.markRead);
router.put("/:id/read", c.markRead);
module.exports = router;
