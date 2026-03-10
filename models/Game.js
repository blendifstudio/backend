import mongoose from "mongoose";

const gameSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  difficulty: { type: String, default: "practice" },
  score:     { type: Number, required: true },
  timeline:  [
    {
      elapsed: Number,
      timeslot: Number,
      question: String,
      answer: Number,
      topic: String, // addition, subtraction, multiplication, division
      correct: { type: Boolean, default: true } // 👈 NEW: track if answer was correct
    }
  ],
  // 👇 NEW: Track wrong attempts separately for deficiency analysis
  wrongAttempts: [
    {
      question: String,
      studentAnswer: Number,
      correctAnswer: Number,
      topic: String,
      timeTaken: Number,
      timestamp: { type: Date, default: Date.now }
    }
  ],
  // 👇 PHASE 9: Flag to distinguish practice sessions from assessments
  isPractice: { type: Boolean, default: false },
  totalTime: { type: Number, default: 0 },
  questionsAnswered: { type: Number, default: 0 },
  date: { type: Date, default: Date.now }
});

export default mongoose.model("Game", gameSchema);
