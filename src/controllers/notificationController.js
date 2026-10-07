const Notification = require("../models/Notification");
exports.list = async (req, res) =>
  res.json({ success: true, data: await Notification.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50) });
exports.markRead = async (req, res) => {
  await Notification.updateMany({ user: req.user._id, ...(req.params.id && { _id: req.params.id }) }, { isRead: true });
  res.json({ success: true });
};
