import express from "express";
import * as practiceController from "../controllers/practiceController.js";

const router = express.Router();

// Middleware
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
};

// Practice routes
router.get("/recommendations", ensureAuthenticated, practiceController.getPracticeRecommendations);
router.post("/start", ensureAuthenticated, practiceController.startPractice);
router.post("/save", ensureAuthenticated, practiceController.savePractice);
router.get("/history", ensureAuthenticated, practiceController.getPracticeHistory);

export default router;
