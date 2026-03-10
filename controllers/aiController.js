import Game from "../models/Game.js";
import { getAIFeedback } from "../services/ollamaService.js";
import { analyzeAnswerBatch } from "../services/mlService.js";

// GET /api/ai/feedback  — student's own AI feedback
export const getStudentFeedback = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id, isPractice: false });

    if (games.length === 0) {
      return res.json({
        success: true,
        feedback: {
          insight:       "No games played yet — complete your first assessment to get personalised feedback!",
          practice:      "Start with an Easy assessment to establish your baseline.",
          encouragement: "Every journey starts with a single step. You've got this!"
        },
        rulesBased: true,
        message: "No data yet"
      });
    }

    // ── Aggregate per-topic stats ────────────────────────────────────────────
    const topicStats = {
      addition:       { correct: 0, total: 0, totalTime: 0 },
      subtraction:    { correct: 0, total: 0, totalTime: 0 },
      multiplication: { correct: 0, total: 0, totalTime: 0 },
      division:       { correct: 0, total: 0, totalTime: 0 }
    };

    let totalTime = 0;
    let totalEntries = 0;

    games.forEach(game => {
      game.timeline.forEach(entry => {
        const t = entry.topic;
        if (topicStats[t]) {
          topicStats[t].total += 1;
          topicStats[t].correct += entry.correct !== false ? 1 : 0;
          topicStats[t].totalTime += entry.timeslot || 0;
        }
        totalTime += entry.timeslot || 0;
        totalEntries += 1;
      });

      // Count wrong attempts as additional wrong answers
      if (game.wrongAttempts) {
        game.wrongAttempts.forEach(w => {
          const t = w.topic;
          if (topicStats[t]) {
            topicStats[t].total += 1;
            topicStats[t].correct += 0;
          }
        });
      }
    });

    // Build topicAccuracy object (only include topics with data)
    const topicAccuracy = {};
    const weakTopics = [];

    Object.entries(topicStats).forEach(([topic, s]) => {
      if (s.total > 0) {
        const acc = Math.round((s.correct / s.total) * 100);
        topicAccuracy[topic] = acc;
        if (acc < 70) weakTopics.push(topic);
      }
    });

    const avgResponseTime = totalEntries > 0
      ? Math.round(totalTime / totalEntries)
      : 0;

    // Simple risk score (mirrors analyticsController logic)
    const allCorrect = Object.values(topicStats).reduce((s, t) => s + t.correct, 0);
    const allTotal   = Object.values(topicStats).reduce((s, t) => s + t.total, 0);
    const accuracy   = allTotal > 0 ? (allCorrect / allTotal) * 100 : 100;
    const riskScore  = Math.round(Math.min(100, (100 - accuracy) * 0.8 + (weakTopics.length * 5)));

    // ── Optional ML analysis on wrong attempts ───────────────────────────────
    const allWrong = [];
    games.forEach(game => {
      (game.wrongAttempts || []).forEach(w => {
        allWrong.push({
          question_type:    w.topic,
          correct_or_wrong: 0,
          response_time:    w.timeTaken || 10,
          attempts:         1,
          student_answer:   w.studentAnswer ?? 0,
          correct_answer:   w.correctAnswer ?? 1,
          question:         w.question || ""
        });
      });
    });

    const mlPredictions = allWrong.length > 0
      ? await analyzeAnswerBatch(allWrong)   // returns null if Flask is down
      : null;

    // ── Call Ollama (falls back gracefully) ─────────────────────────────────
    const result = await getAIFeedback({
      username:        req.user.username,
      topicAccuracy,
      avgResponseTime,
      riskScore,
      weakTopics,
      mlPredictions
    });

    res.json({
      success: true,
      feedback:       result.feedback,
      rulesBased:     !result.success,
      ollamaError:    result.error || null,
      topicAccuracy,
      riskScore,
      mlPredictions:  mlPredictions || []
    });
  } catch (err) {
    console.error("AI feedback error:", err);
    res.status(500).json({ error: "Failed to generate AI feedback" });
  }
};

// GET /api/ai/student/:id/feedback  — teacher views a student's AI feedback
export const getStudentFeedbackForTeacher = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.params.id, isPractice: false });

    if (games.length === 0) {
      return res.json({
        success: true,
        feedback: {
          insight:       "This student has not completed any assessments yet.",
          practice:      "Encourage the student to complete their first assessment.",
          encouragement: "Every student can improve with the right support!"
        },
        rulesBased: true
      });
    }

    const topicStats = {
      addition:       { correct: 0, total: 0 },
      subtraction:    { correct: 0, total: 0 },
      multiplication: { correct: 0, total: 0 },
      division:       { correct: 0, total: 0 }
    };
    let totalTime = 0, totalEntries = 0;

    games.forEach(game => {
      game.timeline.forEach(entry => {
        const t = entry.topic;
        if (topicStats[t]) {
          topicStats[t].total += 1;
          topicStats[t].correct += entry.correct !== false ? 1 : 0;
        }
        totalTime += entry.timeslot || 0;
        totalEntries += 1;
      });
    });

    const topicAccuracy = {};
    const weakTopics = [];
    Object.entries(topicStats).forEach(([topic, s]) => {
      if (s.total > 0) {
        const acc = Math.round((s.correct / s.total) * 100);
        topicAccuracy[topic] = acc;
        if (acc < 70) weakTopics.push(topic);
      }
    });

    const avgResponseTime = totalEntries > 0 ? Math.round(totalTime / totalEntries) : 0;
    const allCorrect = Object.values(topicStats).reduce((s, t) => s + t.correct, 0);
    const allTotal   = Object.values(topicStats).reduce((s, t) => s + t.total, 0);
    const accuracy   = allTotal > 0 ? (allCorrect / allTotal) * 100 : 100;
    const riskScore  = Math.round(Math.min(100, (100 - accuracy) * 0.8 + (weakTopics.length * 5)));

    // Use the student's username if available (pass via query param for now)
    const studentName = req.query.name || "this student";

    const result = await getAIFeedback({
      username: studentName,
      topicAccuracy,
      avgResponseTime,
      riskScore,
      weakTopics
    });

    res.json({
      success: true,
      feedback:     result.feedback,
      rulesBased:   !result.success,
      ollamaError:  result.error || null,
      topicAccuracy,
      riskScore
    });
  } catch (err) {
    console.error("Teacher AI feedback error:", err);
    res.status(500).json({ error: "Failed to generate AI feedback" });
  }
};
