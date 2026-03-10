import express from "express";
import * as gameController from "../controllers/gameController.js";

const router = express.Router();

// Middleware
const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
};

// Game routes
router.post("/save", ensureAuthenticated, gameController.saveGame);
router.get("/history", ensureAuthenticated, gameController.getGameHistory);
router.get("/leaderboard", gameController.getLeaderboard);

export default router;
