import Game from "../models/Game.js";

// Save game result
export const saveGame = async (req, res) => {
  const { difficulty, score, timeline, wrongAttempts } = req.body;
  try {
    const game = new Game({
      userId: req.user._id,
      difficulty,
      score,
      timeline,
      wrongAttempts: wrongAttempts || []
    });
    await game.save();
    res.json({ success: true, game });
  } catch (err) {
    res.status(500).json({ error: "Failed to save game data" });
  }
};

// Get game history for authenticated user
export const getGameHistory = async (req, res) => {
  try {
    const games = await Game.find({ userId: req.user._id }).sort({ date: -1 });
    res.json({ success: true, games });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
};

// Get leaderboard
export const getLeaderboard = async (req, res) => {
  try {
    const games = await Game.find()
      .populate("userId", "username")
      .sort({ score: -1 })
      .limit(50);

    // Group by user and get their best scores for each difficulty
    const userBestScores = {};
    games.forEach(game => {
      const userId = game.userId?._id?.toString();
      if (!userId || !game.userId.username) return;
      
      if (!userBestScores[userId]) {
        userBestScores[userId] = {
          username: game.userId.username,
          easy: 0,
          medium: 0,
          hard: 0
        };
      }
      
      const difficulty = game.difficulty;
      if (game.score > userBestScores[userId][difficulty]) {
        userBestScores[userId][difficulty] = game.score;
      }
    });

    // Calculate total scores
    const leaderboard = Object.values(userBestScores).map(user => ({
      username: user.username,
      easyScore: user.easy,
      mediumScore: user.medium,
      hardScore: user.hard,
      totalScore: user.easy + user.medium + user.hard
    }));

    // Sort by total score
    leaderboard.sort((a, b) => b.totalScore - a.totalScore);

    res.json({ success: true, leaderboard: leaderboard.slice(0, 10) });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: "Failed to fetch leaderboard" });
  }
};
