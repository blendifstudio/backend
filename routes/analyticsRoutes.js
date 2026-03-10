import express from "express";
import * as analyticsController from "../controllers/analyticsController.js";

const router = express.Router();

// Middleware
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
};

// Analytics routes
router.get("/topics", ensureAuthenticated, analyticsController.getTopicAnalytics);
router.get("/deficiencies", ensureAuthenticated, analyticsController.getDeficiencies);
router.get("/mistake-patterns", ensureAuthenticated, analyticsController.getMistakePatterns);
router.get("/risk-score", ensureAuthenticated, analyticsController.getRiskScore);

export default router;
