import Game from "../models/Game.js";
import { analyzeMistakePatterns } from "../utils/practiceHelper.js";

// Get topic analytics
export const getTopicAnalytics = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    const allGames = await Game.find({});
    
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
    
    // Calculate student topic stats (correct + wrong)
    const topicStats = {
      addition:       { correct: 0, wrong: 0, totalTime: 0, count: 0 },
      subtraction:    { correct: 0, wrong: 0, totalTime: 0, count: 0 },
      multiplication: { correct: 0, wrong: 0, totalTime: 0, count: 0 },
      division:       { correct: 0, wrong: 0, totalTime: 0, count: 0 }
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
      (game.wrongAttempts || []).forEach(wa => {
        const topic = wa.topic;
        if (topicStats[topic]) {
          topicStats[topic].wrong += 1;
        }
      });
    });

    const analytics = Object.keys(topicStats).map(topic => {
      const stat = topicStats[topic];
      const totalAttempts = stat.correct + stat.wrong;
      const accuracy = totalAttempts > 0
        ? Math.round((stat.correct / totalAttempts) * 100)
        : 0;

      const avgTime = stat.count > 0 ? (stat.totalTime / stat.count) : 0;
      const classAvg = classAverages[topic];
      const studentAvg = parseFloat(avgTime.toFixed(2));

      // Cognitive load: percentage difference from class average
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

      // Topic status based on accuracy
      let topicStatus, riskLevel;
      if (accuracy >= 85) {
        topicStatus = "Strong Concept";
        riskLevel = "Low";
      } else if (accuracy >= 70) {
        topicStatus = "Moderate Understanding";
        riskLevel = "Medium";
      } else if (accuracy >= 50) {
        topicStatus = "Weak Understanding";
        riskLevel = "Medium";
      } else {
        topicStatus = "Learning Deficiency";
        riskLevel = "High";
      }

      // Deficiency only when BOTH conditions are true
      const isDeficient =
        accuracy < 60 &&
        classAvg > 0 &&
        studentAvg > classAvg * 1.3 &&
        accuracy < 85; // guard: never flag if strong

      return {
        topic,
        accuracy,
        avgTime: studentAvg,
        classAvgTime: parseFloat(classAvg.toFixed(2)),
        questionsAttempted: totalAttempts,
        totalTime: stat.totalTime,
        hasHighCognitiveLoad,
        cognitiveLoadLevel,
        percentSlower: parseFloat(diffPct.toFixed(1)),
        topicStatus,
        riskLevel,
        isDeficient
      };
    });

    res.json({ success: true, analytics });
  } catch (err) {
    console.error("Analytics error:", err);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
};

// Get mistake patterns
export const getMistakePatterns = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    
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
};

// Get risk score
export const getRiskScore = async (req, res) => {
  try {
    const riskData = await calculateRiskScore(req.user._id);
    res.json({ success: true, riskData });
  } catch (err) {
    console.error("Risk score error:", err);
    res.status(500).json({ error: "Failed to calculate risk score" });
  }
};

// Helper: Calculate risk score
async function calculateRiskScore(userId) {
  const games = await Game.find({ userId });
  
  if (games.length === 0) {
    return {
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
    };
  }
  
  // Totals across all games
  let totalCorrect = 0;
  let totalWrong = 0;

  games.forEach(game => {
    totalCorrect += game.timeline.length;
    if (game.wrongAttempts) totalWrong += game.wrongAttempts.length;
  });

  const totalQuestions = totalCorrect + totalWrong;
  const errorRate = totalQuestions > 0 ? totalWrong / totalQuestions : 0;
  const accuracy  = totalQuestions > 0 ? (totalCorrect / totalQuestions) * 100 : 100;

  // Response time factor: how much slower than class average (0-1 scale)
  const allGames = await Game.find({});
  const classTimeTotals = { total: 0, count: 0 };
  allGames.forEach(g => {
    g.timeline.forEach(e => {
      if (e.timeslot) { classTimeTotals.total += e.timeslot; classTimeTotals.count += 1; }
    });
  });
  const classAvgTime = classTimeTotals.count > 0 ? classTimeTotals.total / classTimeTotals.count : 0;

  let studentTimeTotal = 0, studentTimeCount = 0;
  games.forEach(g => {
    g.timeline.forEach(e => {
      if (e.timeslot) { studentTimeTotal += e.timeslot; studentTimeCount += 1; }
    });
  });
  const studentAvgTime = studentTimeCount > 0 ? studentTimeTotal / studentTimeCount : 0;

  const diffPct = classAvgTime > 0
    ? Math.max(0, (studentAvgTime - classAvgTime) / classAvgTime)
    : 0;
  const responseTimeFactor = Math.min(diffPct, 1);

  // Attempt factor: volume of mistakes normalised to 30
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

  return {
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
        topicsWithHighLoad: diffPct > 0.5 ? 1 : 0,
        topicsAnalyzed: 4,
        status: diffPct > 0.5 ? "High" : diffPct >= 0.2 ? "Medium" : "Good"
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
}

// Note: Deficiency detection and other complex analytics can be added here
export const getDeficiencies = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id });
    const allGames = await Game.find({});

    if (games.length === 0) {
      return res.json({ success: true, deficiencies: [] });
    }

    // Build class-wide average response time per topic
    const classTopicTimes = {};
    allGames.forEach(game => {
      (game.timeline || []).forEach(entry => {
        const t = entry.topic;
        if (!t) return;
        if (!classTopicTimes[t]) classTopicTimes[t] = { totalTime: 0, count: 0 };
        classTopicTimes[t].totalTime += entry.timeslot || 0;
        classTopicTimes[t].count += 1;
      });
    });

    // Build per-topic stats for this student
    const topicStats = {};
    games.forEach(game => {
      (game.timeline || []).forEach(e => {
        const t = e.topic || "unknown";
        if (!topicStats[t]) topicStats[t] = { correct: 0, wrong: 0, totalTime: 0, count: 0 };
        topicStats[t].correct += 1;
        topicStats[t].totalTime += e.timeslot || 0;
        topicStats[t].count += 1;
      });
      (game.wrongAttempts || []).forEach(w => {
        const t = w.topic || "unknown";
        if (!topicStats[t]) topicStats[t] = { correct: 0, wrong: 0, totalTime: 0, count: 0 };
        topicStats[t].wrong += 1;
      });
    });

    const deficiencies = Object.entries(topicStats)
      .map(([topic, s]) => {
        const total = s.correct + s.wrong;
        const accuracy = total > 0 ? Math.round((s.correct / total) * 100) : 0;
        const studentAvgTime = s.count > 0 ? s.totalTime / s.count : 0;
        const classData = classTopicTimes[topic];
        const classAvgTime = classData && classData.count > 0
          ? classData.totalTime / classData.count
          : 0;

        // Deficiency: BOTH conditions must be true; never flag if accuracy >= 85%
        const isDeficient =
          accuracy < 60 &&
          accuracy < 85 &&
          classAvgTime > 0 &&
          studentAvgTime > classAvgTime * 1.3;

        return {
          topic,
          accuracy,
          errorRate: total > 0 ? Math.round((s.wrong / total) * 100) : 0,
          wrongCount: s.wrong,
          correctCount: s.correct,
          totalAttempts: total,
          studentAvgTime: parseFloat(studentAvgTime.toFixed(2)),
          classAvgTime: parseFloat(classAvgTime.toFixed(2)),
          isDeficient
        };
      })
      .filter(d => d.isDeficient)
      .sort((a, b) => a.accuracy - b.accuracy);

    res.json({ success: true, deficiencies });
  } catch (err) {
    console.error("Deficiency detection error:", err);
    res.status(500).json({ error: "Failed to detect deficiencies" });
  }
};
