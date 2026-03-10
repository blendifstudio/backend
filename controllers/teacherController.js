import bcrypt from "bcrypt";
import User from "../models/User.js";
import Game from "../models/Game.js";
import { analyzeMistakePatterns } from "../utils/practiceHelper.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const getTeacherStudentIds = (teacher) =>
  (teacher.teacherInfo?.students || []).map((id) => id.toString());

const guardStudentAccess = (teacher, studentId) =>
  getTeacherStudentIds(teacher).includes(studentId.toString());

// ─── Create new student with PIN (teacher-issued credentials) ───────────────
export const createStudent = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Student name is required" });
    }
    const cleanName = name.trim().slice(0, 50);

    // Build a username from the name (lowercase, spaces → underscores)
    const baseUsername = cleanName.replace(/\s+/g, "_").toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!baseUsername) return res.status(400).json({ error: "Name contains no valid characters" });

    // Ensure uniqueness
    let username = baseUsername;
    let suffix = 1;
    while (await User.findOne({ username })) {
      username = `${baseUsername}${suffix++}`;
    }

    // Generate random 4-digit PIN
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    const pinHash = await bcrypt.hash(pin, 12);

    const student = new User({
      username,
      email: `${username}@pin.local`,   // unique placeholder – no real email needed
      passwordHash: null,
      pin: pinHash,
      role: "student",
      createdByTeacher: req.user._id,
      profile: { firstName: cleanName },
      studentInfo: { totalPoints: 0, badges: [], streak: { current: 0, longest: 0 } }
    });
    await student.save();

    // Add to teacher's roster
    const teacher = await User.findById(req.user._id);
    teacher.teacherInfo.students.push(student._id);
    await teacher.save();

    res.json({
      success: true,
      student: { _id: student._id, username, displayName: cleanName },
      credentials: { username, pin }   // plaintext PIN shown once
    });
  } catch (err) {
    console.error("Create student error:", err);
    res.status(500).json({ error: "Failed to create student" });
  }
};

// ─── Reset student PIN ────────────────────────────────────────────────────────
export const resetStudentPin = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) {
      return res.status(403).json({ error: "Access denied" });
    }
    const student = await User.findById(studentId);
    if (!student) return res.status(404).json({ error: "Student not found" });

    const pin = String(Math.floor(1000 + Math.random() * 9000));
    student.pin = await bcrypt.hash(pin, 12);
    await student.save();

    res.json({ success: true, credentials: { username: student.username, pin } });
  } catch (err) {
    console.error("Reset PIN error:", err);
    res.status(500).json({ error: "Failed to reset PIN" });
  }
};

// ─── Add student by username ──────────────────────────────────────────────────
export const addStudent = async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username is required" });
    }
    const student = await User.findOne({ username: username.trim(), role: "student" });
    if (!student) {
      return res.status(404).json({ error: "No student found with that username" });
    }
    const teacher = await User.findById(req.user._id);
    if (getTeacherStudentIds(teacher).includes(student._id.toString())) {
      return res.status(409).json({ error: "Student already in your roster" });
    }
    teacher.teacherInfo.students.push(student._id);
    await teacher.save();
    res.json({ success: true, student: { _id: student._id, username: student.username, email: student.email } });
  } catch (err) {
    console.error("Add student error:", err);
    res.status(500).json({ error: "Failed to add student" });
  }
};

// ─── Remove student ───────────────────────────────────────────────────────────
export const removeStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) {
      return res.status(404).json({ error: "Student not in your roster" });
    }
    teacher.teacherInfo.students = teacher.teacherInfo.students.filter(
      (id) => id.toString() !== studentId
    );
    await teacher.save();
    res.json({ success: true });
  } catch (err) {
    console.error("Remove student error:", err);
    res.status(500).json({ error: "Failed to remove student" });
  }
};

// ─── Get enrolled students ────────────────────────────────────────────────────
export const getStudents = async (req, res) => {
  try {
    const teacher = await User.findById(req.user._id).populate("teacherInfo.students", "username email");
    const enrolledStudents = teacher.teacherInfo?.students || [];
    if (enrolledStudents.length === 0) {
      return res.json({ success: true, students: [] });
    }
    const studentIds = enrolledStudents.map((s) => s._id);
    const gameStats = await Game.aggregate([
      { $match: { userId: { $in: studentIds } } },
      {
        $group: {
          _id: "$userId",
          gamesPlayed:  { $sum: 1 },
          totalScore:   { $sum: "$score" },
          totalCorrect: { $sum: { $size: { $ifNull: ["$timeline", []] } } },
          totalWrong:   { $sum: { $size: { $ifNull: ["$wrongAttempts", []] } } },
          lastPlayed:   { $max: "$date" }
        }
      }
    ]);
    const statsMap = {};
    gameStats.forEach((g) => { statsMap[g._id.toString()] = g; });
    const students = enrolledStudents.map((s) => {
      const stats   = statsMap[s._id.toString()] || {};
      const correct = stats.totalCorrect || 0;
      const wrong   = stats.totalWrong   || 0;
      const total   = correct + wrong;
      return {
        _id:          s._id,
        username:     s.username,
        email:        s.email,
        gamesPlayed:  stats.gamesPlayed || 0,
        totalGames:   stats.gamesPlayed || 0,
        totalScore:   stats.totalScore  || 0,
        totalCorrect: correct,
        totalWrong:   wrong,
        accuracy:     total > 0 ? ((correct / total) * 100).toFixed(1) : "0.0",
        avgScore:     stats.gamesPlayed > 0 ? (stats.totalScore / stats.gamesPlayed).toFixed(1) : "0.0",
        lastPlayed:   stats.lastPlayed || null,
        hasDeficiencies: total > 0 && (correct / total) < 0.7
      };
    });
    res.json({ success: true, students });
  } catch (err) {
    console.error("Fetch students error:", err);
    res.status(500).json({ error: "Failed to fetch students" });
  }
};


// ─── Get student deficiencies (scoped to teacher's roster) ───────────────────
export const getStudentDeficiencies = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) return res.status(403).json({ error: "Access denied" });
    const games = await Game.find({ userId: studentId });
    const allGames = await Game.find({ userId: { $in: getTeacherStudentIds(teacher) } });
    
    if (games.length === 0) {
      return res.json({ success: true, deficiencies: [] });
    }
    
    // Calculate class averages for comparison
    const classTopicStats = {
      addition: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      subtraction: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      multiplication: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      division: { totalTime: 0, count: 0, correct: 0, wrong: 0 }
    };
    
    allGames.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (classTopicStats[topic]) {
          classTopicStats[topic].totalTime += entry.timeslot || 0;
          classTopicStats[topic].count += 1;
          classTopicStats[topic].correct += 1;
        }
      });
      if (game.wrongAttempts) {
        game.wrongAttempts.forEach(wa => {
          const topic = wa.topic;
          if (classTopicStats[topic]) {
            classTopicStats[topic].wrong += 1;
          }
        });
      }
    });
    
    // Calculate student stats
    const studentTopicStats = {
      addition: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      subtraction: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      multiplication: { totalTime: 0, count: 0, correct: 0, wrong: 0 },
      division: { totalTime: 0, count: 0, correct: 0, wrong: 0 }
    };
    
    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (studentTopicStats[topic]) {
          studentTopicStats[topic].totalTime += entry.timeslot || 0;
          studentTopicStats[topic].count += 1;
          studentTopicStats[topic].correct += 1;
        }
      });
      if (game.wrongAttempts) {
        game.wrongAttempts.forEach(wa => {
          const topic = wa.topic;
          if (studentTopicStats[topic]) {
            studentTopicStats[topic].wrong += 1;
          }
        });
      }
    });
    
    // Identify deficiencies
    const deficiencies = [];
    Object.keys(studentTopicStats).forEach(topic => {
      const studentStat = studentTopicStats[topic];
      const classStat = classTopicStats[topic];
      
      if (studentStat.count === 0) return;
      
      const totalStudent = studentStat.correct + studentStat.wrong;
      const studentAccuracy = totalStudent > 0 ? (studentStat.correct / totalStudent) * 100 : 0;
      const studentAvgTime = studentStat.count > 0 ? studentStat.totalTime / studentStat.count : 0;
      
      const totalClass = classStat.correct + classStat.wrong;
      const classAccuracy = totalClass > 0 ? (classStat.correct / totalClass) * 100 : 0;
      const classAvgTime = classStat.count > 0 ? classStat.totalTime / classStat.count : 0;
      
      // Topic status and risk level based on accuracy alone
      let topicStatus, riskLevel;
      if (studentAccuracy >= 85) {
        topicStatus = "Strong Concept";
        riskLevel = "Low";
      } else if (studentAccuracy >= 70) {
        topicStatus = "Moderate Understanding";
        riskLevel = "Medium";
      } else if (studentAccuracy >= 50) {
        topicStatus = "Weak Understanding";
        riskLevel = "Medium";
      } else {
        topicStatus = "Learning Deficiency";
        riskLevel = "High";
      }

      // Deficiency: BOTH conditions required; accuracy ≥ 85% is NEVER a deficiency
      const isDeficient =
        studentAccuracy < 60 &&
        studentAccuracy < 85 &&
        classAvgTime > 0 &&
        studentAvgTime > classAvgTime * 1.3;
      
      if (isDeficient) {
        deficiencies.push({
          topic,
          message: `Struggling with ${topic}`,
          topicStatus,
          accuracy: Math.round(studentAccuracy),
          correct: studentStat.correct,
          wrong: studentStat.wrong,
          avgTime: studentAvgTime.toFixed(2),
          overallAvgTime: classAvgTime.toFixed(2),
          riskLevel,
          confidence: Math.round(Math.min(totalStudent / 10, 1) * 100)
        });
      }
    });
    
    res.json({ success: true, deficiencies });
  } catch (err) {
    console.error("Deficiency fetch error:", err);
    res.status(500).json({ error: "Failed to fetch deficiencies" });
  }
};

// Get student cognitive load
export const getStudentCognitiveLoad = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) return res.status(403).json({ error: "Access denied" });
    const games = await Game.find({ userId: studentId });
    const allGames = await Game.find({ userId: { $in: getTeacherStudentIds(teacher) } });
    
    if (games.length === 0) {
      return res.json({ success: true, cognitiveLoad: [] });
    }
    
    // Calculate class averages
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
    
    // Calculate student topic stats
    const topicStats = {
      addition: { correct: 0, totalTime: 0, count: 0 },
      subtraction: { correct: 0, totalTime: 0, count: 0 },
      multiplication: { correct: 0, totalTime: 0, count: 0 },
      division: { correct: 0, totalTime: 0, count: 0 }
    };

    games.forEach(game => {
      game.timeline.forEach(entry => {
        const topic = entry.topic;
        if (topicStats[topic]) {
          topicStats[topic].correct += 1;
          topicStats[topic].totalTime += entry.timeslot || 0;
          topicStats[topic].count += 1;
        }
      });
    });

    const cognitiveLoad = Object.keys(topicStats).map(topic => {
      const stat = topicStats[topic];
      const studentAvg = stat.count > 0 ? stat.totalTime / stat.count : 0;
      const classAvg = classAverages[topic];

      // Percentage difference from class average
      const diffPct = classAvg > 0
        ? ((studentAvg - classAvg) / classAvg) * 100
        : 0;

      let cognitiveLoadLevel = "Normal";
      let hasHighCognitiveLoad = false;
      if (diffPct > 50) {
        cognitiveLoadLevel = "High";
        hasHighCognitiveLoad = true;
      } else if (diffPct >= 20) {
        cognitiveLoadLevel = "Medium";
      }

      return {
        topic,
        avgTime: parseFloat(studentAvg.toFixed(2)),
        classAvgTime: parseFloat(classAvg.toFixed(2)),
        questionsAttempted: stat.count,
        hasHighCognitiveLoad,
        cognitiveLoadLevel,
        percentSlower: parseFloat(diffPct.toFixed(1))
      };
    });
    
    res.json({ success: true, cognitiveLoad });
  } catch (err) {
    console.error("Cognitive load error:", err);
    res.status(500).json({ error: "Failed to fetch cognitive load" });
  }
};

// Get student mistake patterns
export const getStudentMistakePatterns = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) return res.status(403).json({ error: "Access denied" });
    const games = await Game.find({ userId: studentId });
    
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
        summary: { totalMistakes: 0, message: "No mistakes recorded for this student" }
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
};

// Get student risk score
export const getStudentRiskScore = async (req, res) => {
  try {
    const { studentId } = req.params;
    const teacher = await User.findById(req.user._id);
    if (!guardStudentAccess(teacher, studentId)) return res.status(403).json({ error: "Access denied" });
    const games = await Game.find({ userId: studentId });
    
    if (games.length === 0) {
      return res.json({
        success: true,
        riskData: {
          riskScore: 50,
          riskLevel: "Medium",
          riskColor: "#f59e0b",
          riskIcon: "⚠️",
          factors: {
            accuracy: { score: 50, status: "No Data" },
            cognitiveLoad: { topicsWithHighLoad: 0, topicsAnalyzed: 0, status: "No Data" },
            deficiencies: { count: 0, status: "No Data" },
            engagement: { gamesPlayed: 0, status: "No Data" }
          },
          message: "No data available yet"
        }
      });
    }
    
    // Calculate accuracy
    let totalCorrect = 0;
    let totalWrong = 0;

    games.forEach(game => {
      totalCorrect += game.timeline.length;
      if (game.wrongAttempts) totalWrong += game.wrongAttempts.length;
    });

    const totalQuestions = totalCorrect + totalWrong;
    const accuracy  = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 100;
    const errorRate = totalQuestions > 0 ? totalWrong / totalQuestions : 0;

    // Response time factor vs class average
    const classTopicTimesRisk = {};
    (await Game.find({ userId: { $in: getTeacherStudentIds(await User.findById(req.user._id)) } }))
      .forEach(g => {
        g.timeline.forEach(e => {
          if (e.timeslot) {
            if (!classTopicTimesRisk._all) classTopicTimesRisk._all = { total: 0, count: 0 };
            classTopicTimesRisk._all.total += e.timeslot;
            classTopicTimesRisk._all.count += 1;
          }
        });
      });
    const classAvgTimeRisk = classTopicTimesRisk._all && classTopicTimesRisk._all.count > 0
      ? classTopicTimesRisk._all.total / classTopicTimesRisk._all.count
      : 0;

    let studentTimeTotal = 0, studentTimeCount = 0;
    games.forEach(g => {
      g.timeline.forEach(e => {
        if (e.timeslot) { studentTimeTotal += e.timeslot; studentTimeCount += 1; }
      });
    });
    const studentAvgTimeRisk = studentTimeCount > 0 ? studentTimeTotal / studentTimeCount : 0;

    const diffPctRisk = classAvgTimeRisk > 0
      ? Math.max(0, (studentAvgTimeRisk - classAvgTimeRisk) / classAvgTimeRisk)
      : 0;
    const responseTimeFactor = Math.min(diffPctRisk, 1);

    // Attempt factor: volume of wrong answers normalised to 30
    const attemptFactor = Math.min(totalWrong / 30, 1);

    // Weighted risk score (0-100)
    const rawScore = (0.6 * errorRate) + (0.3 * responseTimeFactor) + (0.1 * attemptFactor);
    const totalRiskScore = Math.round(rawScore * 100);

    let riskLevel = "Low";
    let riskColor = "#10b981";
    let riskIcon = "✅";

    if (totalRiskScore >= 61) {
      riskLevel = "High";
      riskColor = "#ef4444";
      riskIcon = "🚨";
    } else if (totalRiskScore >= 31) {
      riskLevel = "Medium";
      riskColor = "#f59e0b";
      riskIcon = "⚠️";
    }

    const riskData = {
      riskScore: totalRiskScore,
      riskLevel,
      riskColor,
      riskIcon,
      factors: {
        accuracy: {
          score: Math.round(accuracy),
          status: accuracy >= 85 ? "Good" : accuracy >= 70 ? "Fair" : "Poor"
        },
        cognitiveLoad: {
          topicsWithHighLoad: diffPctRisk > 0.5 ? 1 : 0,
          topicsAnalyzed: 4,
          status: diffPctRisk > 0.5 ? "High" : diffPctRisk >= 0.2 ? "Medium" : "Good"
        },
        deficiencies: {
          count: 0,
          status: "Good"
        },
        engagement: {
          gamesPlayed: games.length,
          status: games.length >= 10 ? "Good" : games.length >= 5 ? "Fair" : "Poor"
        }
      }
    };

    res.json({ success: true, riskData });
  } catch (err) {
    console.error("Risk score error:", err);
    res.status(500).json({ error: "Failed to calculate risk score" });
  }
};

// Get class analytics
export const getClassAnalytics = async (req, res) => {
  try {
    const teacher = await User.findById(req.user._id);
    const studentIds = getTeacherStudentIds(teacher);
    const allStudents = await User.find({ _id: { $in: studentIds } });
    const allGames = await Game.find({ userId: { $in: studentIds } });
    
    const classStats = {
      totalStudents: allStudents.length,
      totalGames: allGames.length,
      avgScore: allGames.length > 0 ? (allGames.reduce((sum, g) => sum + g.score, 0) / allGames.length).toFixed(1) : 0,
      avgAccuracy: 85
    };
    
    res.json({ success: true, classStats });
  } catch (err) {
    console.error("Class analytics error:", err);
    res.status(500).json({ error: "Failed to fetch class analytics" });
  }
};

// Get heatmap
export const getHeatmap = async (req, res) => {
  try {
    const teacher = await User.findById(req.user._id);
    const studentIds = getTeacherStudentIds(teacher);
    const students = await User.find({ _id: { $in: studentIds } }, "username");
    const allGames = await Game.find({ userId: { $in: studentIds } });

    const topics = ["addition", "subtraction", "multiplication", "division"];
    const heatmap = students.map(student => {
      const studentGames = allGames.filter(g => g.userId.toString() === student._id.toString());
      const topicData = {};
      topics.forEach(topic => {
        let correct = 0, wrong = 0, totalTime = 0;
        studentGames.forEach(game => {
          game.timeline.forEach(entry => {
            if (entry.topic === topic) {
              correct++;
              totalTime += entry.timeslot || 0;
            }
          });
          if (game.wrongAttempts) {
            game.wrongAttempts.forEach(wa => { if (wa.topic === topic) wrong++; });
          }
        });
        const total = correct + wrong;
        topicData[topic] = {
          accuracy: total > 0 ? Math.round((correct / total) * 100) : null,
          avgTime: correct > 0 ? parseFloat((totalTime / correct).toFixed(2)) : null,
          attempts: total
        };
      });
      return { studentId: student._id, username: student.username, topics: topicData };
    });

    res.json({ success: true, heatmap });
  } catch (err) {
    console.error("Heatmap error:", err);
    res.status(500).json({ error: "Failed to generate heatmap" });
  }
};
