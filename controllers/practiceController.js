import Game from "../models/Game.js";
import { generatePersonalizedPractice, analyzeMistakePatterns } from "../utils/practiceHelper.js";

// Get practice recommendations
export const getPracticeRecommendations = async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const practiceData = await generatePersonalizedPractice(req.user._id, count);
    res.json({ success: true, ...practiceData });
  } catch (err) {
    console.error("Practice generation error:", err);
    res.status(500).json({ error: "Failed to generate practice recommendations" });
  }
};

// Start practice session
export const startPractice = async (req, res) => {
  try {
    const { count = 10 } = req.body;
    const practiceData = await generatePersonalizedPractice(req.user._id, count);
    
    res.json({ 
      success: true, 
      questions: practiceData.practiceQuestions,
      recommendations: practiceData.recommendations,
      weakTopics: practiceData.weakTopics
    });
  } catch (err) {
    console.error("Practice start error:", err);
    res.status(500).json({ error: "Failed to start practice session" });
  }
};

// Save practice session results
export const savePractice = async (req, res) => {
  try {
    const { score, timeline, wrongAttempts, totalTime, questionsAnswered } = req.body;
    
    // Save as a Game but with a flag indicating it's practice
    const practiceSession = new Game({
      userId: req.user._id,
      difficulty: req.body.difficulty || "practice",
      score,
      timeline: timeline || [],
      wrongAttempts: wrongAttempts || [],
      totalTime: totalTime || 0,
      questionsAnswered: questionsAnswered || 0,
      isPractice: true,
      date: new Date()
    });
    
    await practiceSession.save();
    
    res.json({ 
      success: true, 
      message: "Practice session saved!",
      sessionId: practiceSession._id
    });
  } catch (err) {
    console.error("Practice save error:", err);
    res.status(500).json({ error: "Failed to save practice session" });
  }
};

// Get practice history
export const getPracticeHistory = async (req, res) => {
  try {
    const practiceSessions = await Game.find({ 
      userId: req.user._id,
      isPractice: true 
    }).sort({ date: -1 }).limit(20);
    
    res.json({ success: true, sessions: practiceSessions });
  } catch (err) {
    console.error("Practice history error:", err);
    res.status(500).json({ error: "Failed to fetch practice history" });
  }
};
