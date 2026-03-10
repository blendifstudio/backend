import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import passport from "passport";
import session from "express-session";
import LocalStrategy from "passport-local";
import MongoStore from "connect-mongo";

import User from "./models/User.js";
import Game from "./models/Game.js";

dotenv.config();
const app = express();

// CORS allow frontend with credentials for sessions
app.use(cors({
  origin: "http://localhost:5173", // your frontend URL
  credentials: true
}));

app.use(express.json());

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));

// Session config with MongoDB store
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    httpOnly: true,
    sameSite: "lax"
  }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport local auth strategy
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await User.findOne({ username });
    if (!user) return done(null, false, { message: "Incorrect username." });

    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) return done(null, false, { message: "Incorrect password." });

    return done(null, user);
  } catch (err) {
    return done(err);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err);
  }
});

// Authentication check middleware
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Unauthorized" });
}

// Teacher role check middleware
function ensureTeacher(req, res, next) {
  if (req.isAuthenticated() && req.user.role === "teacher") return next();
  res.status(403).json({ error: "Access denied. Teacher role required." });
}

// ---------- AUTH ROUTES ----------

// Signup endpoint
app.post("/api/signup", async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  // Validate role
  const userRole = role && ["student", "teacher"].includes(role) ? role : "student";

  try {
    const existing = await User.findOne({ username });
    if (existing) return res.status(409).json({ error: "Username already taken" });

    const hash = await bcrypt.hash(password, 10);
    
    // Initialize user with empty profile structures
    const userData = { 
      username, 
      email, 
      passwordHash: hash, 
      role: userRole,
      profile: {},
      lastLogin: Date.now()
    };
    
    // Initialize role-specific data structures
    if (userRole === "student") {
      userData.studentInfo = {
        totalPoints: 0,
        badges: [],
        streak: { current: 0, longest: 0 }
      };
    } else if (userRole === "teacher") {
      userData.teacherInfo = {
        classesTeaching: []
      };
    }
    
    const user = new User(userData);
    await user.save();

    req.login(user, (err) => {
      if (err) throw err;
      res.json({ 
        username: user.username, 
        email: user.email, 
        role: user.role,
        profile: user.profile || {},
        studentInfo: user.role === "student" ? user.studentInfo : undefined,
        teacherInfo: user.role === "teacher" ? user.teacherInfo : undefined
      });
    });
  } catch (err) {
    res.status(500).json({ error: "Signup error: " + err.message });
  }
});

// Login endpoint
app.post("/api/login", (req, res, next) => {
  passport.authenticate("local", async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(400).json({ error: info.message });
    
    // Update last login timestamp
    try {
      await User.findByIdAndUpdate(user._id, { lastLogin: Date.now() });
    } catch (updateErr) {
      console.error("Failed to update lastLogin:", updateErr);
    }
    
    req.logIn(user, (err) => {
      if (err) return next(err);
      return res.json({ 
        username: user.username, 
        email: user.email, 
        role: user.role,
        profile: user.profile || {},
        studentInfo: user.role === "student" ? user.studentInfo : undefined,
        teacherInfo: user.role === "teacher" ? user.teacherInfo : undefined
      });
    });
  })(req, res, next);
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  req.logout(() => res.json({ message: "Logged out" }));
});

// Profile endpoint - Returns complete profile based on role
app.get("/api/profile", ensureAuthenticated, (req, res) => {
  const profileData = { 
    username: req.user.username, 
    email: req.user.email, 
    role: req.user.role,
    profile: req.user.profile || {},
    createdAt: req.user.createdAt,
    lastLogin: req.user.lastLogin
  };
  
  // Add role-specific data
  if (req.user.role === "student") {
    profileData.studentInfo = req.user.studentInfo || {};
  } else if (req.user.role === "teacher") {
    profileData.teacherInfo = req.user.teacherInfo || {};
  }
  
  res.json(profileData);
});

// Update profile endpoint
app.put("/api/profile", ensureAuthenticated, async (req, res) => {
  try {
    const { profile, studentInfo, teacherInfo } = req.body;
    const userId = req.user._id;
    
    const updateData = { updatedAt: Date.now() };
    
    // Update common profile fields
    if (profile) {
      updateData.profile = {
        ...req.user.profile,
        ...profile
      };
    }
    
    // Update role-specific fields
    if (req.user.role === "student" && studentInfo) {
      updateData.studentInfo = {
        ...req.user.studentInfo,
        ...studentInfo
      };
    } else if (req.user.role === "teacher" && teacherInfo) {
      updateData.teacherInfo = {
        ...req.user.teacherInfo,
        ...teacherInfo
      };
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      userId, 
      { $set: updateData },
      { new: true, runValidators: true }
    );
    
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({ 
      success: true, 
      message: "Profile updated successfully",
      user: {
        username: updatedUser.username,
        email: updatedUser.email,
        role: updatedUser.role,
        profile: updatedUser.profile,
        studentInfo: updatedUser.role === "student" ? updatedUser.studentInfo : undefined,
        teacherInfo: updatedUser.role === "teacher" ? updatedUser.teacherInfo : undefined
      }
    });
  } catch (err) {
    console.error("Profile update error:", err);
    res.status(500).json({ error: "Failed to update profile: " + err.message });
  }
});

// Get public profile (for teachers viewing student profiles)
app.get("/api/profile/:userId", ensureAuthenticated, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Teachers can view any profile, students can only view their own
    if (req.user.role !== "teacher" && req.user._id.toString() !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }
    
    const user = await User.findById(userId).select("-passwordHash");
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    const profileData = {
      username: user.username,
      email: user.email,
      role: user.role,
      profile: user.profile || {},
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    };
    
    // Add role-specific data
    if (user.role === "student") {
      profileData.studentInfo = user.studentInfo || {};
    } else if (user.role === "teacher") {
      profileData.teacherInfo = user.teacherInfo || {};
    }
    
    res.json(profileData);
  } catch (err) {
    console.error("Get profile error:", err);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

// ---------- GAME DATA ROUTES ----------

// Save game result for authenticated user
app.post("/api/game/save", ensureAuthenticated, async (req, res) => {
  const { difficulty, score, timeline, wrongAttempts } = req.body; // 👈 accept wrongAttempts
  try {
    const game = new Game({
      userId: req.user._id,
      difficulty,
      score,
      timeline,
      wrongAttempts: wrongAttempts || [] // 👈 store wrong attempts
    });
    await game.save();
    res.json({ success: true, game });
  } catch (err) {
    res.status(500).json({ error: "Failed to save game data" });
  }
});

// Get game history for authenticated user
app.get("/api/game/history", ensureAuthenticated, async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id }).sort({ date: -1 });
    res.json({ success: true, games });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// 👇 NEW: Analytics endpoint - per-topic performance for authenticated user (with cognitive load)
app.get("/api/analytics/topics", ensureAuthenticated, async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    
    // Get all games to calculate class averages
    const allGames = await Game.find({});
    
    // Calculate class average time per topic
    const classTopicTimes = {
      addition: { totalTime: 0, count: 0 },
      subtraction: { totalTime: 0, count: 0 },
      multiplication: { totalTime: 0, count: 0 },
      division: { totalTime: 0, count: 0 }
    };
    
    allGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (classTopicTimes[topic] && entry.timeslot) {
          classTopicTimes[topic].totalTime += entry.timeslot;
          classTopicTimes[topic].count += 1;
        }
      });
    });
    
    const classAverages = {};
    Object.keys(classTopicTimes).forEach(topic => {
      const data = classTopicTimes[topic];
      classAverages[topic] = data.count > 0 ? data.totalTime / data.count : 0;
    });
    
    // Calculate per-topic statistics for student
    const topicStats = {
      addition: { correct: 0, totalTime: 0, count: 0 },
      subtraction: { correct: 0, totalTime: 0, count: 0 },
      multiplication: { correct: 0, totalTime: 0, count: 0 },
      division: { correct: 0, totalTime: 0, count: 0 }
    };

    // Aggregate data from all game timelines
    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicStats[topic]) {
          topicStats[topic].correct += 1; // All answered questions are correct
          topicStats[topic].totalTime += entry.timeslot || 0;
          topicStats[topic].count += 1;
        }
      });
    });

    // Calculate metrics for each topic with cognitive load detection
    const analytics = Object.keys(topicStats).map(topic => {
      const stat = topicStats[topic];
      const avgTime = stat.count > 0 ? (stat.totalTime / stat.count).toFixed(2) : 0;
      const accuracy = stat.count > 0 ? 100 : 0; // Always 100% for answered questions
      
      const classAvg = classAverages[topic];
      const studentAvg = parseFloat(avgTime);
      
      // Detect cognitive load: student takes 50%+ longer than class average
      const hasHighCognitiveLoad = studentAvg > (classAvg * 1.5) && stat.count >= 3;
      
      let cognitiveLoadLevel = "Normal";
      if (studentAvg > (classAvg * 3)) {
        cognitiveLoadLevel = "Very High";
      } else if (studentAvg > (classAvg * 2)) {
        cognitiveLoadLevel = "High";
      } else if (studentAvg > (classAvg * 1.5)) {
        cognitiveLoadLevel = "Moderate";
      }
      
      return {
        topic,
        accuracy,
        avgTime: studentAvg,
        classAvgTime: parseFloat(classAvg.toFixed(2)),
        questionsAttempted: stat.count,
        totalTime: stat.totalTime,
        hasHighCognitiveLoad,
        cognitiveLoadLevel,
        percentSlower: classAvg > 0 ? (((studentAvg - classAvg) / classAvg) * 100).toFixed(1) : 0
      };
    });

    res.json({ success: true, analytics });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

// 👇 NEW: Deficiency Detection Endpoint - Core Innovation Feature
app.get("/api/analytics/deficiencies", ensureAuthenticated, async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    
    // Track per-topic statistics
    const topicData = {
      addition: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      subtraction: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      multiplication: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      division: { correct: 0, wrong: 0, totalTime: 0, attempts: [] }
    };

    // Aggregate correct answers from timeline
    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicData[topic]) {
          topicData[topic].correct += 1;
          topicData[topic].totalTime += entry.timeslot || 0;
          topicData[topic].attempts.push({ correct: true, time: entry.timeslot || 0 });
        }
      });

      // Aggregate wrong answers
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        game.wrongAttempts.forEach(wrongEntry => {
          const topic = wrongEntry.topic;
          if (topicData[topic]) {
            topicData[topic].wrong += 1;
            topicData[topic].totalTime += wrongEntry.timeTaken || 0;
            topicData[topic].attempts.push({ correct: false, time: wrongEntry.timeTaken || 0 });
          }
        });
      }
    });

    // Calculate overall average time across all topics
    let totalAttempts = 0;
    let totalTime = 0;
    Object.values(topicData).forEach(data => {
      totalAttempts += data.correct + data.wrong;
      totalTime += data.totalTime;
    });
    const overallAvgTime = totalAttempts > 0 ? totalTime / totalAttempts : 0;

    // Deficiency Detection Algorithm (Your Core Innovation)
    const deficiencies = [];
    
    Object.keys(topicData).forEach(topic => {
      const data = topicData[topic];
      const totalQuestions = data.correct + data.wrong;
      
      if (totalQuestions === 0) return; // Skip if no data
      
      const accuracy = (data.correct / totalQuestions) * 100;
      const avgTime = data.totalTime / totalQuestions;
      
      // 🎯 CORE ALGORITHM: IF accuracy < 50% AND time > average THEN deficiency
      const isDeficient = accuracy < 50 && avgTime > overallAvgTime;
      
      // Calculate confidence score based on:
      // - How far below 50% accuracy
      // - How much slower than average
      // - Number of attempts (more data = higher confidence)
      let confidence = 0;
      if (isDeficient) {
        const accuracyGap = (50 - accuracy) / 50; // 0 to 1
        const timeGap = avgTime > 0 ? Math.min((avgTime - overallAvgTime) / overallAvgTime, 1) : 0; // 0 to 1
        const dataConfidence = Math.min(totalQuestions / 10, 1); // More attempts = more confident, cap at 10
        
        confidence = Math.round(((accuracyGap * 0.5 + timeGap * 0.3 + dataConfidence * 0.2) * 100));
      }
      
      // Determine risk level
      let riskLevel = "Low";
      if (accuracy < 30) riskLevel = "High";
      else if (accuracy < 50) riskLevel = "Medium";
      
      if (isDeficient) {
        deficiencies.push({
          topic,
          accuracy: accuracy.toFixed(1),
          avgTime: avgTime.toFixed(2),
          overallAvgTime: overallAvgTime.toFixed(2),
          totalQuestions,
          correct: data.correct,
          wrong: data.wrong,
          riskLevel,
          confidence,
          message: `⚠️ ${topic.charAt(0).toUpperCase() + topic.slice(1)} deficiency detected`
        });
      }
    });

    res.json({ 
      success: true, 
      deficiencies,
      hasDeficiencies: deficiencies.length > 0,
      overallAvgTime: overallAvgTime.toFixed(2)
    });
  } catch (err) {
    console.error("Deficiency detection error:", err);
    res.status(500).json({ error: "Failed to detect deficiencies" });
  }
});

// Cognitive Load Detection - Compare student time vs class average (teacher only)
app.get("/api/teacher/students/:studentId/cognitive-load", ensureTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    
    // Get all students' games to calculate class averages
    const allGames = await Game.find({});
    
    // Calculate class average time per topic
    const classTopicTimes = {
      addition: { totalTime: 0, count: 0 },
      subtraction: { totalTime: 0, count: 0 },
      multiplication: { totalTime: 0, count: 0 },
      division: { totalTime: 0, count: 0 }
    };
    
    allGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (classTopicTimes[topic] && entry.timeslot) {
          classTopicTimes[topic].totalTime += entry.timeslot;
          classTopicTimes[topic].count += 1;
        }
      });
    });
    
    const classAverages = {};
    Object.keys(classTopicTimes).forEach(topic => {
      const data = classTopicTimes[topic];
      classAverages[topic] = data.count > 0 ? data.totalTime / data.count : 0;
    });
    
    // Get specific student's games
    const studentGames = await Game.find({ userId: studentId });
    
    // Calculate student's average time per topic
    const studentTopicTimes = {
      addition: { totalTime: 0, count: 0 },
      subtraction: { totalTime: 0, count: 0 },
      multiplication: { totalTime: 0, count: 0 },
      division: { totalTime: 0, count: 0 }
    };
    
    studentGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (studentTopicTimes[topic] && entry.timeslot) {
          studentTopicTimes[topic].totalTime += entry.timeslot;
          studentTopicTimes[topic].count += 1;
        }
      });
    });
    
    // Analyze cognitive load per topic
    const cognitiveLoad = [];
    
    Object.keys(studentTopicTimes).forEach(topic => {
      const studentData = studentTopicTimes[topic];
      const classAvg = classAverages[topic];
      
      if (studentData.count === 0) return; // Skip if no data
      
      const studentAvg = studentData.totalTime / studentData.count;
      const difference = studentAvg - classAvg;
      const percentageDifference = classAvg > 0 ? ((difference / classAvg) * 100).toFixed(1) : 0;
      
      // Detect high cognitive load: student takes 50%+ longer than class average
      const hasHighLoad = studentAvg > (classAvg * 1.5);
      
      if (hasHighLoad) {
        let loadLevel = "Moderate";
        if (studentAvg > (classAvg * 2)) {
          loadLevel = "High";
        } else if (studentAvg > (classAvg * 3)) {
          loadLevel = "Very High";
        }
        
        cognitiveLoad.push({
          topic,
          studentAvgTime: studentAvg.toFixed(2),
          classAvgTime: classAvg.toFixed(2),
          difference: difference.toFixed(2),
          percentSlower: percentageDifference,
          loadLevel,
          questionsAnalyzed: studentData.count,
          warning: `⚠️ High cognitive load detected on ${topic}`
        });
      }
    });
    
    res.json({
      success: true,
      cognitiveLoad,
      hasHighLoad: cognitiveLoad.length > 0,
      classAverages: Object.keys(classAverages).map(topic => ({
        topic,
        avgTime: classAverages[topic].toFixed(2)
      }))
    });
  } catch (err) {
    console.error("Cognitive load detection error:", err);
    res.status(500).json({ error: "Failed to detect cognitive load" });
  }
});

// Helper function to detect operation confusion and patterns in mistakes
function analyzeMistakePatterns(wrongAttempts) {
  const patterns = [];
  const questionFrequency = {}; // Track repeated mistakes on same question
  const operationConfusion = { addition: 0, subtraction: 0, multiplication: 0, division: 0 };
  
  wrongAttempts.forEach(mistake => {
    const { question, studentAnswer, correctAnswer, topic } = mistake;
    
    // Track repeated mistakes on same question
    if (!questionFrequency[question]) {
      questionFrequency[question] = { count: 0, topic, correctAnswer, studentAnswers: [] };
    }
    questionFrequency[question].count += 1;
    questionFrequency[question].studentAnswers.push(studentAnswer);
    
    // Parse the question to extract operands
    const addMatch = question.match(/(\d+)\s*\+\s*(\d+)/);
    const subMatch = question.match(/(\d+)\s*[-−]\s*(\d+)/);
    const mulMatch = question.match(/(\d+)\s*[×*]\s*(\d+)/);
    const divMatch = question.match(/(\d+)\s*[÷/]\s*(\d+)/);
    
    let num1, num2;
    
    if (addMatch) {
      num1 = parseInt(addMatch[1]);
      num2 = parseInt(addMatch[2]);
      
      // Check if student multiplied instead of added
      if (studentAnswer === num1 * num2) {
        operationConfusion.multiplication += 1;
        patterns.push({
          type: "operation_confusion",
          question,
          correctAnswer,
          studentAnswer,
          expectedOperation: "addition",
          usedOperation: "multiplication",
          description: `Used multiplication (${num1}×${num2}=${studentAnswer}) instead of addition`,
          severity: "High"
        });
      }
      // Check if student subtracted instead of added
      else if (studentAnswer === Math.abs(num1 - num2)) {
        operationConfusion.subtraction += 1;
        patterns.push({
          type: "operation_confusion",
          question,
          correctAnswer,
          studentAnswer,
          expectedOperation: "addition",
          usedOperation: "subtraction",
          description: `Used subtraction (${num1}-${num2}=${studentAnswer}) instead of addition`,
          severity: "High"
        });
      }
    }
    
    if (mulMatch) {
      num1 = parseInt(mulMatch[1]);
      num2 = parseInt(mulMatch[2]);
      
      // Check if student added instead of multiplied
      if (studentAnswer === num1 + num2) {
        operationConfusion.addition += 1;
        patterns.push({
          type: "operation_confusion",
          question,
          correctAnswer,
          studentAnswer,
          expectedOperation: "multiplication",
          usedOperation: "addition",
          description: `Used addition (${num1}+${num2}=${studentAnswer}) instead of multiplication`,
          severity: "High"
        });
      }
    }
    
    if (subMatch) {
      num1 = parseInt(subMatch[1]);
      num2 = parseInt(subMatch[2]);
      
      // Check if student added instead of subtracted
      if (studentAnswer === num1 + num2) {
        operationConfusion.addition += 1;
        patterns.push({
          type: "operation_confusion",
          question,
          correctAnswer,
          studentAnswer,
          expectedOperation: "subtraction",
          usedOperation: "addition",
          description: `Used addition (${num1}+${num2}=${studentAnswer}) instead of subtraction`,
          severity: "High"
        });
      }
    }
    
    if (divMatch) {
      num1 = parseInt(divMatch[1]);
      num2 = parseInt(divMatch[2]);
      
      // Check if student multiplied instead of divided
      if (studentAnswer === num1 * num2) {
        operationConfusion.multiplication += 1;
        patterns.push({
          type: "operation_confusion",
          question,
          correctAnswer,
          studentAnswer,
          expectedOperation: "division",
          usedOperation: "multiplication",
          description: `Used multiplication (${num1}×${num2}=${studentAnswer}) instead of division`,
          severity: "High"
        });
      }
    }
    
    // Check for digit reversal (e.g., 54 becomes 45)
    const correctStr = correctAnswer.toString();
    const studentStr = studentAnswer.toString();
    if (correctStr.length === studentStr.length && correctStr.split('').reverse().join('') === studentStr) {
      patterns.push({
        type: "digit_reversal",
        question,
        correctAnswer,
        studentAnswer,
        description: `Reversed digits: answered ${studentAnswer} instead of ${correctAnswer}`,
        severity: "Medium"
      });
    }
    
    // Check for off-by-one errors
    if (Math.abs(studentAnswer - correctAnswer) === 1) {
      patterns.push({
        type: "calculation_error",
        question,
        correctAnswer,
        studentAnswer,
        description: `Off by one: answered ${studentAnswer} instead of ${correctAnswer}`,
        severity: "Low"
      });
    }
  });
  
  // Detect repeated mistakes on same questions
  Object.keys(questionFrequency).forEach(question => {
    const data = questionFrequency[question];
    if (data.count >= 2) {
      patterns.push({
        type: "repeated_mistake",
        question,
        correctAnswer: data.correctAnswer,
        topic: data.topic,
        timesWrong: data.count,
        studentAnswers: data.studentAnswers,
        description: `Answered "${question}" wrong ${data.count} times`,
        severity: "High"
      });
    }
  });
  
  return {
    patterns,
    summary: {
      totalMistakes: wrongAttempts.length,
      operationConfusion: Object.keys(operationConfusion).filter(op => operationConfusion[op] > 0).length > 0 ? operationConfusion : null,
      repeatedMistakes: Object.keys(questionFrequency).filter(q => questionFrequency[q].count >= 2).length,
      uniqueQuestionsWrong: Object.keys(questionFrequency).length
    }
  };
}

// Mistake Pattern Analysis - Student (authenticated user)
app.get("/api/analytics/mistake-patterns", ensureAuthenticated, async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    
    // Collect all wrong attempts
    const allWrongAttempts = [];
    games.forEach(game => {
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        allWrongAttempts.push(...game.wrongAttempts);
      }
    });
    
    if (allWrongAttempts.length === 0) {
      return res.json({
        success: true,
        patterns: [],
        summary: {
          totalMistakes: 0,
          message: "No mistakes recorded yet. Keep practicing!"
        }
      });
    }
    
    const analysis = analyzeMistakePatterns(allWrongAttempts);
    
    res.json({
      success: true,
      patterns: analysis.patterns,
      summary: analysis.summary
    });
  } catch (err) {
    console.error("Mistake pattern analysis error:", err);
    res.status(500).json({ error: "Failed to analyze mistake patterns" });
  }
});

// Mistake Pattern Analysis - Teacher view for specific student
app.get("/api/teacher/students/:studentId/mistake-patterns", ensureTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    const games = await Game.find({ userId: studentId });
    
    // Collect all wrong attempts
    const allWrongAttempts = [];
    games.forEach(game => {
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        allWrongAttempts.push(...game.wrongAttempts);
      }
    });
    
    if (allWrongAttempts.length === 0) {
      return res.json({
        success: true,
        patterns: [],
        summary: {
          totalMistakes: 0,
          message: "No mistakes recorded for this student"
        }
      });
    }
    
    const analysis = analyzeMistakePatterns(allWrongAttempts);
    
    res.json({
      success: true,
      patterns: analysis.patterns,
      summary: analysis.summary
    });
  } catch (err) {
    console.error("Mistake pattern analysis error:", err);
    res.status(500).json({ error: "Failed to analyze mistake patterns" });
  }
});

// Helper function to calculate risk score (0-100%)
async function calculateRiskScore(userId) {
  try {
    const games = await Game.find({ userId });
    
    if (games.length === 0) {
      return {
        riskScore: 50, // Neutral score for no data
        riskLevel: "Medium",
        factors: {
          accuracy: { score: 50, weight: 40, contribution: 20 },
          cognitiveLoad: { score: 50, weight: 30, contribution: 15 },
          deficiencies: { score: 50, weight: 20, contribution: 10 },
          engagement: { score: 50, weight: 10, contribution: 5 }
        },
        message: "No data available yet. Start practicing to get your risk assessment!"
      };
    }
    
    // === FACTOR 1: ACCURACY (40% weight) ===
    let totalCorrect = 0;
    let totalWrong = 0;
    
    games.forEach(game => {
      totalCorrect += game.timeline.length;
      if (game.wrongAttempts) {
        totalWrong += game.wrongAttempts.length;
      }
    });
    
    const totalQuestions = totalCorrect + totalWrong;
    const accuracy = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 100;
    
    // Convert accuracy to risk: lower accuracy = higher risk
    // 100% accuracy = 0% risk, 0% accuracy = 100% risk
    const accuracyRisk = 100 - accuracy;
    const accuracyContribution = (accuracyRisk * 40) / 100;
    
    // === FACTOR 2: COGNITIVE LOAD (30% weight) ===
    // Calculate cognitive load per topic
    const allGames = await Game.find({});
    const classTopicTimes = {
      addition: { totalTime: 0, count: 0 },
      subtraction: { totalTime: 0, count: 0 },
      multiplication: { totalTime: 0, count: 0 },
      division: { totalTime: 0, count: 0 }
    };
    
    allGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (classTopicTimes[topic] && entry.timeslot) {
          classTopicTimes[topic].totalTime += entry.timeslot;
          classTopicTimes[topic].count += 1;
        }
      });
    });
    
    const classAverages = {};
    Object.keys(classTopicTimes).forEach(topic => {
      const data = classTopicTimes[topic];
      classAverages[topic] = data.count > 0 ? data.totalTime / data.count : 0;
    });
    
    const studentTopicTimes = {
      addition: { totalTime: 0, count: 0 },
      subtraction: { totalTime: 0, count: 0 },
      multiplication: { totalTime: 0, count: 0 },
      division: { totalTime: 0, count: 0 }
    };
    
    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (studentTopicTimes[topic] && entry.timeslot) {
          studentTopicTimes[topic].totalTime += entry.timeslot;
          studentTopicTimes[topic].count += 1;
        }
      });
    });
    
    let topicsWithHighLoad = 0;
    let topicsAnalyzed = 0;
    
    Object.keys(studentTopicTimes).forEach(topic => {
      const studentData = studentTopicTimes[topic];
      if (studentData.count >= 3) {
        topicsAnalyzed += 1;
        const studentAvg = studentData.totalTime / studentData.count;
        const classAvg = classAverages[topic];
        if (studentAvg > (classAvg * 1.5)) {
          topicsWithHighLoad += 1;
        }
      }
    });
    
    // Convert to risk: 0 topics with high load = 0% risk, all topics = 100% risk
    const cognitiveLoadRisk = topicsAnalyzed > 0 ? (topicsWithHighLoad / topicsAnalyzed) * 100 : 0;
    const cognitiveLoadContribution = (cognitiveLoadRisk * 30) / 100;
    
    // === FACTOR 3: DEFICIENCIES (20% weight) ===
    const topicData = {
      addition: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      subtraction: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      multiplication: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      division: { correct: 0, wrong: 0, totalTime: 0, attempts: [] }
    };

    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicData[topic]) {
          topicData[topic].correct += 1;
          topicData[topic].totalTime += entry.timeslot || 0;
          topicData[topic].attempts.push({ correct: true, time: entry.timeslot || 0 });
        }
      });

      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        game.wrongAttempts.forEach(wrongEntry => {
          const topic = wrongEntry.topic;
          if (topicData[topic]) {
            topicData[topic].wrong += 1;
            topicData[topic].totalTime += wrongEntry.timeTaken || 0;
            topicData[topic].attempts.push({ correct: false, time: wrongEntry.timeTaken || 0 });
          }
        });
      }
    });

    let totalTimesAcrossTopics = 0;
    let totalAttemptsAcrossTopics = 0;
    Object.keys(topicData).forEach(topic => {
      const data = topicData[topic];
      totalTimesAcrossTopics += data.totalTime;
      totalAttemptsAcrossTopics += data.attempts.length;
    });
    const overallAvgTime = totalAttemptsAcrossTopics > 0 ? totalTimesAcrossTopics / totalAttemptsAcrossTopics : 0;

    let deficiencyCount = 0;
    Object.keys(topicData).forEach(topic => {
      const data = topicData[topic];
      const total = data.correct + data.wrong;
      if (total >= 5) {
        const topicAccuracy = (data.correct / total) * 100;
        const avgTime = data.totalTime / total;
        
        if (topicAccuracy < 50 && avgTime > overallAvgTime) {
          deficiencyCount += 1;
        }
      }
    });
    
    // Convert to risk: 0 deficiencies = 0% risk, 4 deficiencies (all topics) = 100% risk
    const deficiencyRisk = (deficiencyCount / 4) * 100;
    const deficiencyContribution = (deficiencyRisk * 20) / 100;
    
    // === FACTOR 4: ENGAGEMENT (10% weight) ===
    // More games = lower risk, fewer games = higher risk
    // 0 games = 100% risk, 20+ games = 0% risk
    const engagementScore = Math.min(games.length / 20, 1) * 100; // Scale to 0-100
    const engagementRisk = 100 - engagementScore;
    const engagementContribution = (engagementRisk * 10) / 100;
    
    // === TOTAL RISK SCORE ===
    const totalRiskScore = accuracyContribution + cognitiveLoadContribution + deficiencyContribution + engagementContribution;
    
    // Determine risk level
    let riskLevel = "Low";
    let riskColor = "#10b981"; // green
    let riskIcon = "✅";
    
    if (totalRiskScore >= 67) {
      riskLevel = "High";
      riskColor = "#ef4444"; // red
      riskIcon = "🚨";
    } else if (totalRiskScore >= 34) {
      riskLevel = "Medium";
      riskColor = "#f59e0b"; // orange
      riskIcon = "⚠️";
    }
    
    return {
      riskScore: Math.round(totalRiskScore),
      riskLevel,
      riskColor,
      riskIcon,
      factors: {
        accuracy: {
          score: Math.round(accuracy),
          risk: Math.round(accuracyRisk),
          weight: 40,
          contribution: Math.round(accuracyContribution * 10) / 10,
          status: accuracy >= 80 ? "Good" : accuracy >= 50 ? "Fair" : "Poor"
        },
        cognitiveLoad: {
          topicsWithHighLoad,
          topicsAnalyzed,
          risk: Math.round(cognitiveLoadRisk),
          weight: 30,
          contribution: Math.round(cognitiveLoadContribution * 10) / 10,
          status: topicsWithHighLoad === 0 ? "Good" : topicsWithHighLoad <= 1 ? "Fair" : "Poor"
        },
        deficiencies: {
          count: deficiencyCount,
          risk: Math.round(deficiencyRisk),
          weight: 20,
          contribution: Math.round(deficiencyContribution * 10) / 10,
          status: deficiencyCount === 0 ? "Good" : deficiencyCount <= 1 ? "Fair" : "Poor"
        },
        engagement: {
          gamesPlayed: games.length,
          score: Math.round(engagementScore),
          risk: Math.round(engagementRisk),
          weight: 10,
          contribution: Math.round(engagementContribution * 10) / 10,
          status: games.length >= 10 ? "Good" : games.length >= 5 ? "Fair" : "Poor"
        }
      }
    };
  } catch (err) {
    console.error("Risk calculation error:", err);
    throw err;
  }
}

// Risk Score - Student (authenticated user)
app.get("/api/analytics/risk-score", ensureAuthenticated, async (req, res) => {
  try {
    const riskData = await calculateRiskScore(req.user._id);
    res.json({ success: true, riskData });
  } catch (err) {
    console.error("Risk score error:", err);
    res.status(500).json({ error: "Failed to calculate risk score" });
  }
});

// Risk Score - Teacher view for specific student
app.get("/api/teacher/students/:studentId/risk-score", ensureTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    const riskData = await calculateRiskScore(studentId);
    res.json({ success: true, riskData });
  } catch (err) {
    console.error("Risk score error:", err);
    res.status(500).json({ error: "Failed to calculate risk score" });
  }
});

// ========== PHASE 9: PERSONALIZED PRACTICE GENERATOR ==========

// Helper function to generate personalized practice questions
async function generatePersonalizedPractice(userId, count = 10) {
  try {
    // Fetch student's games
    const games = await Game.find({ userId });
    
    if (games.length === 0) {
      // No data yet - return balanced practice
      return {
        recommendations: [],
        practiceQuestions: generateBalancedPractice(count),
        message: "Start with balanced practice to assess your strengths"
      };
    }
    
    // Calculate topic statistics
    const topicData = {
      addition: { correct: 0, wrong: 0, totalTime: 0 },
      subtraction: { correct: 0, wrong: 0, totalTime: 0 },
      multiplication: { correct: 0, wrong: 0, totalTime: 0 },
      division: { correct: 0, wrong: 0, totalTime: 0 }
    };
    
    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicData[topic]) {
          topicData[topic].correct += 1;
          topicData[topic].totalTime += entry.timeslot || 0;
        }
      });
      
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        game.wrongAttempts.forEach(wrongEntry => {
          const topic = wrongEntry.topic;
          if (topicData[topic]) {
            topicData[topic].wrong += 1;
            topicData[topic].totalTime += wrongEntry.timeTaken || 0;
          }
        });
      }
    });
    
    // Identify weak topics (accuracy < 60%)
    const weakTopics = [];
    const recommendations = [];
    
    Object.keys(topicData).forEach(topic => {
      const data = topicData[topic];
      const totalQuestions = data.correct + data.wrong;
      
      if (totalQuestions === 0) return;
      
      const accuracy = (data.correct / totalQuestions) * 100;
      const avgTime = data.totalTime / totalQuestions;
      
      if (accuracy < 60) {
        weakTopics.push({
          topic,
          accuracy: accuracy.toFixed(1),
          priority: accuracy < 40 ? "High" : accuracy < 50 ? "Medium" : "Low",
          totalQuestions,
          avgTime: avgTime.toFixed(2)
        });
        
        recommendations.push({
          topic,
          message: `Focus on ${topic} - current accuracy: ${accuracy.toFixed(1)}%`,
          targetAccuracy: "70%",
          suggestedQuestions: Math.ceil((60 - accuracy) / 5) // More practice for weaker topics
        });
      }
    });
    
    // Sort weak topics by priority (lowest accuracy first)
    weakTopics.sort((a, b) => parseFloat(a.accuracy) - parseFloat(b.accuracy));
    
    // Analyze mistake patterns to focus practice
    let allWrongAttempts = [];
    games.forEach(game => {
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        allWrongAttempts = allWrongAttempts.concat(game.wrongAttempts);
      }
    });
    
    const mistakePatterns = analyzeMistakePatterns(allWrongAttempts);
    
    // Add pattern-based recommendations
    const operationConfusionPatterns = mistakePatterns.filter(p => p.type === "operation_confusion");
    if (operationConfusionPatterns.length > 0) {
      const confusedOps = [...new Set(operationConfusionPatterns.map(p => p.expectedOperation))];
      recommendations.push({
        topic: "operation_clarity",
        message: `Practice distinguishing between operations (${confusedOps.join(", ")})`,
        targetAccuracy: "90%",
        suggestedQuestions: 5
      });
    }
    
    // Generate practice questions targeting weak areas
    const practiceQuestions = generateTargetedPractice(weakTopics, mistakePatterns, count);
    
    return {
      weakTopics,
      recommendations,
      practiceQuestions,
      mistakeCount: allWrongAttempts.length,
      patternCount: mistakePatterns.length
    };
  } catch (err) {
    console.error("Practice generation error:", err);
    throw err;
  }
}

// Generate balanced practice for new students
function generateBalancedPractice(count) {
  const questions = [];
  const topics = ["addition", "subtraction", "multiplication", "division"];
  const questionsPerTopic = Math.ceil(count / 4);
  
  topics.forEach(topic => {
    for (let i = 0; i < questionsPerTopic && questions.length < count; i++) {
      questions.push(generateQuestionForTopic(topic, "easy"));
    }
  });
  
  return questions;
}

// Generate targeted practice questions
function generateTargetedPractice(weakTopics, mistakePatterns, count) {
  const questions = [];
  
  if (weakTopics.length === 0) {
    // No weak topics - generate mixed practice
    return generateBalancedPractice(count);
  }
  
  // Allocate questions based on weakness priority
  const highPriority = weakTopics.filter(t => t.priority === "High");
  const mediumPriority = weakTopics.filter(t => t.priority === "Medium");
  const lowPriority = weakTopics.filter(t => t.priority === "Low");
  
  // 60% high priority, 30% medium, 10% low
  const highCount = Math.ceil(count * 0.6);
  const mediumCount = Math.ceil(count * 0.3);
  const lowCount = count - highCount - mediumCount;
  
  // Generate questions for each priority level
  if (highPriority.length > 0) {
    const perTopic = Math.ceil(highCount / highPriority.length);
    highPriority.forEach(topic => {
      for (let i = 0; i < perTopic && questions.length < count; i++) {
        const difficulty = parseFloat(topic.accuracy) < 40 ? "easy" : "medium";
        questions.push(generateQuestionForTopic(topic.topic, difficulty));
      }
    });
  }
  
  if (mediumPriority.length > 0) {
    const perTopic = Math.ceil(mediumCount / mediumPriority.length);
    mediumPriority.forEach(topic => {
      for (let i = 0; i < perTopic && questions.length < count; i++) {
        questions.push(generateQuestionForTopic(topic.topic, "medium"));
      }
    });
  }
  
  if (lowPriority.length > 0) {
    const perTopic = Math.ceil(lowCount / lowPriority.length);
    lowPriority.forEach(topic => {
      for (let i = 0; i < perTopic && questions.length < count; i++) {
        questions.push(generateQuestionForTopic(topic.topic, "medium"));
      }
    });
  }
  
  // Fill remaining with mixed practice if needed
  while (questions.length < count) {
    const randomTopic = weakTopics[Math.floor(Math.random() * weakTopics.length)];
    questions.push(generateQuestionForTopic(randomTopic.topic, "medium"));
  }
  
  return questions;
}

// Generate a single question for a specific topic and difficulty
function generateQuestionForTopic(topic, difficulty) {
  let num1, num2, answer, question;
  
  // Difficulty ranges
  const ranges = {
    easy: { min: 1, max: 10 },
    medium: { min: 5, max: 20 },
    hard: { min: 10, max: 50 }
  };
  
  const range = ranges[difficulty] || ranges.medium;
  
  switch(topic) {
    case "addition":
      num1 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      num2 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      answer = num1 + num2;
      question = `${num1} + ${num2}`;
      break;
      
    case "subtraction":
      num1 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      num2 = Math.floor(Math.random() * num1) + 1; // Ensure positive result
      answer = num1 - num2;
      question = `${num1} - ${num2}`;
      break;
      
    case "multiplication":
      num1 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      num2 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      answer = num1 * num2;
      question = `${num1} × ${num2}`;
      break;
      
    case "division":
      num2 = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      answer = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
      num1 = num2 * answer; // Ensure clean division
      question = `${num1} ÷ ${num2}`;
      break;
      
    default:
      num1 = Math.floor(Math.random() * 10) + 1;
      num2 = Math.floor(Math.random() * 10) + 1;
      answer = num1 + num2;
      question = `${num1} + ${num2}`;
  }
  
  return {
    topic,
    difficulty,
    question,
    answer,
    generatedAt: new Date()
  };
}

// Practice recommendations endpoint
app.get("/api/analytics/practice-recommendations", ensureAuthenticated, async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const practiceData = await generatePersonalizedPractice(req.user._id, count);
    res.json({ success: true, ...practiceData });
  } catch (err) {
    console.error("Practice generation error:", err);
    res.status(500).json({ error: "Failed to generate practice recommendations" });
  }
});

// Generate practice session
app.post("/api/practice/start", ensureAuthenticated, async (req, res) => {
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
});

// Save practice session results (similar to game but marked as practice)
app.post("/api/practice/save", ensureAuthenticated, async (req, res) => {
  try {
    const { score, timeline, wrongAttempts, totalTime, questionsAnswered } = req.body;
    
    // Save as a Game but with a flag indicating it's practice
    const practiceSession = new Game({
      userId: req.user._id,
      score,
      timeline: timeline || [],
      wrongAttempts: wrongAttempts || [],
      totalTime: totalTime || 0,
      questionsAnswered: questionsAnswered || 0,
      isPractice: true, // Flag to distinguish practice from assessment
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
});

// Get practice history
app.get("/api/practice/history", ensureAuthenticated, async (req, res) => {
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
});

// ---------- TEACHER DASHBOARD ROUTES ----------

// Get all students (teacher only)
app.get("/api/teacher/students", ensureTeacher, async (req, res) => {
  try {
    const students = await User.find({ role: "student" }).select("username email createdAt");
    
    // Get performance summary for each student
    const studentsWithStats = await Promise.all(
      students.map(async (student) => {
        const games = await Game.find({ userId: student._id });
        
        const totalGames = games.length;
        const totalScore = games.reduce((sum, game) => sum + game.score, 0);
        const avgScore = totalGames > 0 ? (totalScore / totalGames).toFixed(1) : 0;
        
        // Count total correct and wrong
        let totalCorrect = 0;
        let totalWrong = 0;
        
        games.forEach(game => {
          totalCorrect += game.timeline.length;
          totalWrong += game.wrongAttempts ? game.wrongAttempts.length : 0;
        });
        
        const totalAttempts = totalCorrect + totalWrong;
        const accuracy = totalAttempts > 0 ? ((totalCorrect / totalAttempts) * 100).toFixed(1) : 0;
        
        // Check if student has deficiencies
        const hasDeficiencies = parseFloat(accuracy) < 50;
        
        return {
          _id: student._id,
          username: student.username,
          email: student.email,
          totalGames,
          avgScore,
          accuracy,
          totalCorrect,
          totalWrong,
          hasDeficiencies,
          lastPlayed: games.length > 0 ? games[games.length - 1].date : null
        };
      })
    );
    
    res.json({ success: true, students: studentsWithStats });
  } catch (err) {
    console.error("Error fetching students:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// Get specific student's deficiencies (teacher only)
app.get("/api/teacher/students/:studentId/deficiencies", ensureTeacher, async (req, res) => {
  try {
    const { studentId } = req.params;
    const games = await Game.find({ userId: studentId });
    
    if (games.length === 0) {
      return res.json({ success: true, deficiencies: [], hasDeficiencies: false });
    }
    
    // Reuse deficiency detection logic
    const topicData = {
      addition: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      subtraction: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      multiplication: { correct: 0, wrong: 0, totalTime: 0, attempts: [] },
      division: { correct: 0, wrong: 0, totalTime: 0, attempts: [] }
    };

    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicData[topic]) {
          topicData[topic].correct += 1;
          topicData[topic].totalTime += entry.timeslot || 0;
        }
      });

      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        game.wrongAttempts.forEach(wrongEntry => {
          const topic = wrongEntry.topic;
          if (topicData[topic]) {
            topicData[topic].wrong += 1;
            topicData[topic].totalTime += wrongEntry.timeTaken || 0;
          }
        });
      }
    });

    let totalAttempts = 0;
    let totalTime = 0;
    Object.values(topicData).forEach(data => {
      totalAttempts += data.correct + data.wrong;
      totalTime += data.totalTime;
    });
    const overallAvgTime = totalAttempts > 0 ? totalTime / totalAttempts : 0;

    const deficiencies = [];
    
    Object.keys(topicData).forEach(topic => {
      const data = topicData[topic];
      const totalQuestions = data.correct + data.wrong;
      
      if (totalQuestions === 0) return;
      
      const accuracy = (data.correct / totalQuestions) * 100;
      const avgTime = data.totalTime / totalQuestions;
      
      const isDeficient = accuracy < 50 && avgTime > overallAvgTime;
      
      let confidence = 0;
      if (isDeficient) {
        const accuracyGap = (50 - accuracy) / 50;
        const timeGap = avgTime > 0 ? Math.min((avgTime - overallAvgTime) / overallAvgTime, 1) : 0;
        const dataConfidence = Math.min(totalQuestions / 10, 1);
        confidence = Math.round(((accuracyGap * 0.5 + timeGap * 0.3 + dataConfidence * 0.2) * 100));
      }
      
      let riskLevel = "Low";
      if (accuracy < 30) riskLevel = "High";
      else if (accuracy < 50) riskLevel = "Medium";
      
      if (isDeficient) {
        deficiencies.push({
          topic,
          accuracy: accuracy.toFixed(1),
          avgTime: avgTime.toFixed(2),
          overallAvgTime: overallAvgTime.toFixed(2),
          totalQuestions,
          correct: data.correct,
          wrong: data.wrong,
          riskLevel,
          confidence
        });
      }
    });

    res.json({ 
      success: true, 
      deficiencies,
      hasDeficiencies: deficiencies.length > 0
    });
  } catch (err) {
    console.error("Error fetching student deficiencies:", err);
    res.status(500).json({ error: "Failed to fetch student deficiencies" });
  }
});

// Get class-wide analytics (teacher only)
app.get("/api/teacher/analytics/class", ensureTeacher, async (req, res) => {
  try {
    const allStudents = await User.find({ role: "student" });
    const allGames = await Game.find({});
    
    // Topic-wise class statistics
    const topicStats = {
      addition: { correct: 0, wrong: 0, students: new Set() },
      subtraction: { correct: 0, wrong: 0, students: new Set() },
      multiplication: { correct: 0, wrong: 0, students: new Set() },
      division: { correct: 0, wrong: 0, students: new Set() }
    };
    
    allGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicStats[topic]) {
          topicStats[topic].correct += 1;
          topicStats[topic].students.add(game.userId.toString());
        }
      });
      
      if (game.wrongAttempts) {
        game.wrongAttempts.forEach(wrong => {
          const topic = wrong.topic;
          if (topicStats[topic]) {
            topicStats[topic].wrong += 1;
          }
        });
      }
    });
    
    // Calculate weakest topic
    let weakestTopic = null;
    let lowestAccuracy = 100;
    
    const topicAnalytics = Object.keys(topicStats).map(topic => {
      const stat = topicStats[topic];
      const total = stat.correct + stat.wrong;
      const accuracy = total > 0 ? ((stat.correct / total) * 100).toFixed(1) : 0;
      
      if (total > 0 && parseFloat(accuracy) < lowestAccuracy) {
        lowestAccuracy = parseFloat(accuracy);
        weakestTopic = topic;
      }
      
      return {
        topic,
        accuracy: parseFloat(accuracy),
        totalQuestions: total,
        studentsAttempted: stat.students.size
      };
    });
    
    // Count students with deficiencies
    let studentsWithDeficiencies = 0;
    for (const student of allStudents) {
      const games = await Game.find({ userId: student._id });
      let totalCorrect = 0;
      let totalWrong = 0;
      
      games.forEach(game => {
        totalCorrect += game.timeline.length;
        totalWrong += game.wrongAttempts ? game.wrongAttempts.length : 0;
      });
      
      const total = totalCorrect + totalWrong;
      if (total > 0 && (totalCorrect / total) < 0.5) {
        studentsWithDeficiencies++;
      }
    }
    
    res.json({
      success: true,
      classStats: {
        totalStudents: allStudents.length,
        totalGames: allGames.length,
        studentsWithDeficiencies,
        weakestTopic,
        weakestTopicAccuracy: lowestAccuracy.toFixed(1),
        topicBreakdown: topicAnalytics
      }
    });
  } catch (err) {
    console.error("Error fetching class analytics:", err);
    res.status(500).json({ error: "Failed to fetch class analytics" });
  }
});

// Get heatmap data - student × topic performance matrix (teacher only)
app.get("/api/teacher/analytics/heatmap", ensureTeacher, async (req, res) => {
  try {
    const students = await User.find({ role: "student" }).select("username");
    
    const heatmapData = await Promise.all(
      students.map(async (student) => {
        const games = await Game.find({ userId: student._id });
        
        // Calculate per-topic statistics for this student
        const topicStats = {
          addition: { correct: 0, wrong: 0 },
          subtraction: { correct: 0, wrong: 0 },
          multiplication: { correct: 0, wrong: 0 },
          division: { correct: 0, wrong: 0 }
        };
        
        // Aggregate correct answers
        games.forEach(game => {
          game.timeline.forEach(entry => {
            const topic = entry.topic;
            if (topicStats[topic]) {
              topicStats[topic].correct += 1;
            }
          });
          
          // Aggregate wrong answers
          if (game.wrongAttempts && game.wrongAttempts.length > 0) {
            game.wrongAttempts.forEach(wrong => {
              const topic = wrong.topic;
              if (topicStats[topic]) {
                topicStats[topic].wrong += 1;
              }
            });
          }
        });
        
        // Calculate performance level for each topic
        const topicPerformance = {};
        Object.keys(topicStats).forEach(topic => {
          const stat = topicStats[topic];
          const total = stat.correct + stat.wrong;
          
          if (total === 0) {
            topicPerformance[topic] = {
              level: "no-data", // No data
              accuracy: 0,
              total: 0
            };
          } else {
            const accuracy = (stat.correct / total) * 100;
            let level = "strong"; // 🟢 Green
            
            if (accuracy < 50) {
              level = "weak"; // 🔴 Red
            } else if (accuracy < 80) {
              level = "medium"; // 🟡 Yellow/Orange
            }
            
            topicPerformance[topic] = {
              level,
              accuracy: accuracy.toFixed(1),
              total,
              correct: stat.correct,
              wrong: stat.wrong
            };
          }
        });
        
        return {
          studentId: student._id,
          studentName: student.username,
          topics: topicPerformance
        };
      })
    );
    
    res.json({
      success: true,
      heatmap: heatmapData
    });
  } catch (err) {
    console.error("Error fetching heatmap data:", err);
    res.status(500).json({ error: "Failed to fetch heatmap data" });
  }
});

function timelinesToMarkdownTable(timelines) {
  let table = "| Question | Elapsed (seconds) | Operation |\n";
  table += "|----------|-------------------|-----------|\n";

  timelines.forEach((game) => {
    game.forEach(({ question, timeslot, operation }) => {
      const safeOp = operation || detectOperation(question);
      table += `| ${question} | ${timeslot} | ${safeOp} |\n`;
    });
  });

  return table;
}

// Optional: Try to detect operation from question text
function detectOperation(q) {
  if (q.includes("+")) return "Addition";
  if (q.includes("-")) return "Subtraction";
  if (q.includes("×") || q.includes("*")) return "Multiplication";
  if (q.includes("÷") || q.includes("/")) return "Division";
  return "";
}


// ---------- PERPLEXITY ANALYSIS ROUTE ----------

app.post("/analyze", async (req, res) => {
  try {
    const { difficulty, timelines } = req.body;

    // Create markdown table from timelines
    const markdownTable = timelinesToMarkdownTable(timelines);

    const prompt = `You are a helpful and expert math coach.

Analyze the game performance for difficulty level "${difficulty}" based on the provided timelines.

The timelines are in the following Markdown table:

${markdownTable}

Important context for this analysis:
- The player ALWAYS answers correctly. No mistakes occur at any difficulty.
- This analysis must NEVER focus on accuracy or errors — because there are none.
- Your sole goal is to make the player FASTER at solving questions.

Your analysis should focus exclusively on:
- Identifying patterns and trends in response timings (fastest vs. slower responses).
- Highlighting any operations, numbers, or question types where elapsed time is slightly longer.
- Suggesting specific targeted drills, mental tricks, and training methods to improve calculation speed for those slower areas.
- Giving actionable exercises to make mental math faster, more automatic, and sustainable under time pressure.
- Recommending advanced strategies such as chunking, recall cues, visualization, and dual-task training.
- Encouraging practice that pushes speed boundaries while maintaining perfect accuracy.

Remember:
- This is about speed enhancement only.
- Assume perfect accuracy throughout.
`;

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.PERPLEXITY_API_KEY}`
      },
      body: JSON.stringify({
        model: "sonar-pro",
        messages: [
          { role: "system", content: "You are a helpful math coach analyzing performance data." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to analyze timelines" });
  }
});
// Leaderboard route - highest score per user
app.get("/api/leaderboard", async (req, res) => {
  try {
    const leaderboard = await Game.aggregate([
      // Group games by userId and find highest score for each
      {
        $group: {
          _id: "$userId",
          highestScore: { $max: "$score" },
          totalGames: { $sum: 1 },
          lastPlayed: { $max: "$date" }
        }
      },
      // Join with User collection to get username & email
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "userInfo"
        }
      },
      { $unwind: "$userInfo" },
      // Shape the output
      {
        $project: {
          username: "$userInfo.username",
          email: "$userInfo.email",
          highestScore: 1,
          totalGames: 1,
          lastPlayed: 1
        }
      },
      // Sort by highestScore descending
      { $sort: { highestScore: -1 } }
    ]);

    res.json({ success: true, leaderboard });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});


// Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
