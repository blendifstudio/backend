import express from "express";
import * as teacherController from "../controllers/teacherController.js";

const router = express.Router();

// Middleware
const ensureTeacher = (req, res, next) => {
  if (req.isAuthenticated() && req.user.role === "teacher") return next();
  res.status(403).json({ error: "Access denied. Teacher role required." });
};

// Teacher routes
router.post("/students/create", ensureTeacher, teacherController.createStudent);
router.post("/students/:studentId/reset-pin", ensureTeacher, teacherController.resetStudentPin);
router.post("/students/add", ensureTeacher, teacherController.addStudent);
router.delete("/students/:studentId", ensureTeacher, teacherController.removeStudent);
router.get("/students", ensureTeacher, teacherController.getStudents);
router.get("/students/:studentId/deficiencies", ensureTeacher, teacherController.getStudentDeficiencies);
router.get("/students/:studentId/cognitive-load", ensureTeacher, teacherController.getStudentCognitiveLoad);
router.get("/students/:studentId/mistake-patterns", ensureTeacher, teacherController.getStudentMistakePatterns);
router.get("/students/:studentId/risk-score", ensureTeacher, teacherController.getStudentRiskScore);
router.get("/analytics/class", ensureTeacher, teacherController.getClassAnalytics);
router.get("/analytics/heatmap", ensureTeacher, teacherController.getHeatmap);

export default router;
