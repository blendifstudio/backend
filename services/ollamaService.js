import fetch from "node-fetch";

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "gemma3:1b";

function buildPrompt({ username, topicAccuracy, avgResponseTime, riskScore, weakTopics, mlPredictions }) {
  const topicLines = Object.entries(topicAccuracy)
    .map(([topic, acc]) => `  ${topic.charAt(0).toUpperCase() + topic.slice(1)}: ${acc}%`)
    .join("\n");

  const weakList = weakTopics.length > 0 ? weakTopics.join(", ") : "none identified";

  // Optional ML section
  let mlSection = "";
  if (mlPredictions && mlPredictions.length > 0) {
    const patterns = [...new Set(mlPredictions.map(p => p.mistake_pattern).filter(Boolean))];
    const topics   = [...new Set(mlPredictions.map(p => p.recommended_practice_topic).filter(Boolean))];
    const highRisk = mlPredictions.filter(p => p.risk_score >= 60).length;
    mlSection = `
ML Mistake Analysis (${mlPredictions.length} wrong answers analysed):
  Detected mistake patterns: ${patterns.join(", ") || "none"}
  Recommended practice topics: ${topics.join(", ") || "none"}
  High-risk misses: ${highRisk}`;
  }

  return `You are a supportive AI math tutor for a primary school student named ${username}.

Student Performance Data:
Topic Accuracy:
${topicLines}
Average Response Time: ${avgResponseTime} seconds
Overall Risk Score: ${riskScore}/100
Weak Topics: ${weakList}${mlSection}

Based on this data, respond with ONLY a valid JSON object containing exactly these 3 keys (no markdown, no explanation, just JSON):
{
  "insight": "one sentence identifying the main learning gap or strength",
  "practice": "one specific actionable exercise the student can do today",
  "encouragement": "one warm motivational sentence personalized to ${username}"
}`;
}

function parseOllamaResponse(text) {
  try {
    // Extract JSON from response (handles cases where model adds extra text)
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      // Validate required keys exist
      if (parsed.insight && parsed.practice && parsed.encouragement) {
        return parsed;
      }
    }
  } catch (_) {}

  // Fallback if parsing fails
  return {
    insight: "Keep working consistently across all topics to build a strong foundation.",
    practice: "Try 10 minutes of mixed arithmetic practice daily focusing on your weakest topic.",
    encouragement: `${text.split(".")[0] || "You're doing great — keep pushing forward!"}`
  };
}

export async function getAIFeedback(studentStats) {
  const prompt = buildPrompt(studentStats);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        options: {
          temperature: 0.7,
          num_predict: 350
        }
      }),
      // 15 second timeout so the endpoint doesn't hang forever
      signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) {
      throw new Error(`Ollama HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      success: true,
      feedback: parseOllamaResponse(data.response || ""),
      model: data.model
    };
  } catch (err) {
    const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
    const isConnRefused = err.message?.includes("ECONNREFUSED");

    return {
      success: false,
      feedback: generateRuleBasedFeedback(studentStats),
      error: isConnRefused
        ? "Ollama is not running. Start it with: ollama serve"
        : isTimeout
        ? "Ollama took too long to respond."
        : err.message
    };
  }
}

// Rule-based fallback (works without Ollama)
function generateRuleBasedFeedback({ username, topicAccuracy, riskScore, weakTopics }) {
  const lowestTopic = Object.entries(topicAccuracy).sort((a, b) => a[1] - b[1])[0];
  const highestTopic = Object.entries(topicAccuracy).sort((a, b) => b[1] - a[1])[0];

  const practiceMap = {
    multiplication: "Practice your multiplication tables 6–12 with 5 minutes of daily flashcard drills.",
    division:       "Work through division by 6, 7, and 8 using the inverse of multiplication tables.",
    subtraction:    "Practice borrowing/regrouping by solving 3-digit subtraction problems step by step.",
    addition:       "Work on carrying — try adding two 2-digit numbers together as fast as possible.",
    none:           "Try 10 mixed questions covering all four operations daily."
  };

  const weakTopic = lowestTopic?.[0] || "none";
  const weakAcc   = lowestTopic?.[1] ?? 100;
  const strongTopic = highestTopic?.[0] || "addition";
  const strongAcc  = highestTopic?.[1] ?? 100;

  let insight, encouragement;

  if (riskScore >= 67) {
    insight = `${username} is struggling most with ${weakTopic} (${weakAcc}% accuracy) and needs focused intervention.`;
    encouragement = `${username}, every expert was once a beginner — break ${weakTopic} into small steps and tackle one at a time!`;
  } else if (riskScore >= 34) {
    insight = `${username} shows moderate performance; ${weakTopic} at ${weakAcc}% accuracy needs extra attention.`;
    encouragement = `You're making progress, ${username}! A little daily practice on ${weakTopic} will get you over the line.`;
  } else {
    insight = `${username} is performing well — ${strongTopic} is a clear strength at ${strongAcc}% accuracy.`;
    encouragement = `Fantastic work, ${username}! Keep your momentum going and challenge yourself with harder questions!`;
  }

  return {
    insight,
    practice: practiceMap[weakTopic] || practiceMap["none"],
    encouragement
  };
}
