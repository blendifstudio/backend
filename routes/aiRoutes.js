import express from "express";
import * as aiController from "../controllers/aiController.js";

const router = express.Router();

const ensureAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
};

const ensureTeacher = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === "teacher") return next();
  res.status(403).json({ error: "Teacher access only" });
};

// Student gets their own AI feedback
router.get("/feedback", ensureAuthenticated, aiController.getStudentFeedback);

// Teacher gets AI feedback for a specific student
router.get("/student/:id/feedback", ensureTeacher, aiController.getStudentFeedbackForTeacher);

export default router;
