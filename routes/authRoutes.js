import express from "express";
import * as authController from "../controllers/authController.js";

const router = express.Router();

// Middleware
export const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
};

// Auth routes  (authLimiter injected by server.js on /signup and /login only)
router.post("/signup", authController.signup);
router.post("/login", (req, res, next) => authController.login(req, res, next, req.app.locals.passport));
router.post("/logout", authController.logout);
router.get("/profile", ensureAuthenticated, authController.getProfile);
router.put("/profile", ensureAuthenticated, authController.updateProfile);
router.get("/profile/:userId", ensureAuthenticated, authController.getUserProfile);

export default router;
