/**
 * mlService.js
 * Calls the Python Flask ML service (port 5001) to predict weakness/pattern/risk
 * for a single answer submission. Falls back gracefully if the ML server is down.
 */

const ML_BASE = process.env.ML_SERVICE_URL || "http://localhost:5001";

/**
 * Analyze one student answer record.
 * @param {Object} params
 * @param {string} params.question_type   - e.g. "addition", "multiplication"
 * @param {number} params.correct_or_wrong - 1 = correct, 0 = wrong
 * @param {number} params.response_time   - seconds taken
 * @param {number} params.attempts        - number of attempts
 * @param {number} params.student_answer  - what the student answered
 * @param {number} params.correct_answer  - the right answer
 * @param {string} [params.question]      - full question text (optional)
 * @returns {Promise<Object>} ML prediction or null on failure
 */
export async function analyzeAnswer(params) {
  try {
    const res = await fetch(`${ML_BASE}/analyze`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(params),
      signal:  AbortSignal.timeout(5000)     // 5-second timeout
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data : null;
  } catch {
    // ML service unavailable – non-fatal, caller should handle null
    return null;
  }
}

/**
 * Analyze multiple answers at once (batch).
 * @param {Object[]} answers
 * @returns {Promise<Object[]|null>}
 */
export async function analyzeAnswerBatch(answers) {
  try {
    const res = await fetch(`${ML_BASE}/analyze-batch`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ answers }),
      signal:  AbortSignal.timeout(10000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.success ? data.results : null;
  } catch {
    return null;
  }
}
