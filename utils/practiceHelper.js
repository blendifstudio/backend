import Game from "../models/Game.js";

// Analyze mistake patterns
export function analyzeMistakePatterns(wrongAttempts) {
  const patterns = [];
  const questionFrequency = {};
  const operationConfusion = { addition: 0, subtraction: 0, multiplication: 0, division: 0 };
  
  wrongAttempts.forEach(mistake => {
    const { question, studentAnswer, correctAnswer, topic } = mistake;
    
    // Track repeated mistakes
    if (!questionFrequency[question]) {
      questionFrequency[question] = { count: 0, topic, correctAnswer, studentAnswers: [] };
    }
    questionFrequency[question].count += 1;
    questionFrequency[question].studentAnswers.push(studentAnswer);
    
    // Parse question to detect operation confusion
    const addMatch = question.match(/(\d+)\s*\+\s*(\d+)/);
    const subMatch = question.match(/(\d+)\s*[-−]\s*(\d+)/);
    const mulMatch = question.match(/(\d+)\s*[×*]\s*(\d+)/);
    const divMatch = question.match(/(\d+)\s*[÷/]\s*(\d+)/);
    
    let num1, num2;
    
    if (addMatch) {
      num1 = parseInt(addMatch[1]);
      num2 = parseInt(addMatch[2]);
      
      if (studentAnswer === num1 * num2) {
        operationConfusion.multiplication += 1;
        patterns.push({
          type: "operation_confusion",
          question, correctAnswer, studentAnswer,
          expectedOperation: "addition",
          usedOperation: "multiplication",
          description: `Used multiplication (${num1}×${num2}=${studentAnswer}) instead of addition`,
          severity: "High"
        });
      } else if (studentAnswer === Math.abs(num1 - num2)) {
        operationConfusion.subtraction += 1;
        patterns.push({
          type: "operation_confusion",
          question, correctAnswer, studentAnswer,
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
      
      if (studentAnswer === num1 + num2) {
        operationConfusion.addition += 1;
        patterns.push({
          type: "operation_confusion",
          question, correctAnswer, studentAnswer,
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
      
      if (studentAnswer === num1 + num2) {
        operationConfusion.addition += 1;
        patterns.push({
          type: "operation_confusion",
          question, correctAnswer, studentAnswer,
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
      
      if (studentAnswer === num1 * num2) {
        operationConfusion.multiplication += 1;
        patterns.push({
          type: "operation_confusion",
          question, correctAnswer, studentAnswer,
          expectedOperation: "division",
          usedOperation: "multiplication",
          description: `Used multiplication (${num1}×${num2}=${studentAnswer}) instead of division`,
          severity: "High"
        });
      }
    }
    
    // Digit reversal check
    const correctStr = correctAnswer.toString();
    const studentStr = studentAnswer.toString();
    if (correctStr.length === studentStr.length && correctStr.split('').reverse().join('') === studentStr) {
      patterns.push({
        type: "digit_reversal",
        question, correctAnswer, studentAnswer,
        description: `Reversed digits: answered ${studentAnswer} instead of ${correctAnswer}`,
        severity: "Medium"
      });
    }
    
    // Off-by-one errors
    if (Math.abs(studentAnswer - correctAnswer) === 1) {
      patterns.push({
        type: "calculation_error",
        question, correctAnswer, studentAnswer,
        description: `Off by one: answered ${studentAnswer} instead of ${correctAnswer}`,
        severity: "Low"
      });
    }
  });
  
  // Detect repeated mistakes
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

// Generate personalized practice
export async function generatePersonalizedPractice(userId, count = 10) {
  try {
    const games = await Game.find({ userId });
    
    if (games.length === 0) {
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
    
    // Identify weak topics
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
          suggestedQuestions: Math.ceil((60 - accuracy) / 5)
        });
      }
    });
    
    weakTopics.sort((a, b) => parseFloat(a.accuracy) - parseFloat(b.accuracy));
    
    let allWrongAttempts = [];
    games.forEach(game => {
      if (game.wrongAttempts && game.wrongAttempts.length > 0) {
        allWrongAttempts = allWrongAttempts.concat(game.wrongAttempts);
      }
    });
    
    const mistakePatterns = analyzeMistakePatterns(allWrongAttempts);
    
    const practiceQuestions = generateTargetedPractice(weakTopics, mistakePatterns, count);
    
    return {
      weakTopics,
      recommendations,
      practiceQuestions,
      mistakeCount: allWrongAttempts.length,
      patternCount: mistakePatterns.patterns.length
    };
  } catch (err) {
    console.error("Practice generation error:", err);
    throw err;
  }
}

// Generate balanced practice
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

// Generate targeted practice
function generateTargetedPractice(weakTopics, mistakePatterns, count) {
  const questions = [];
  
  if (weakTopics.length === 0) {
    return generateBalancedPractice(count);
  }
  
  const highPriority = weakTopics.filter(t => t.priority === "High");
  const mediumPriority = weakTopics.filter(t => t.priority === "Medium");
  const lowPriority = weakTopics.filter(t => t.priority === "Low");
  
  const highCount = Math.ceil(count * 0.6);
  const mediumCount = Math.ceil(count * 0.3);
  const lowCount = count - highCount - mediumCount;
  
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
  
  while (questions.length < count) {
    const randomTopic = weakTopics[Math.floor(Math.random() * weakTopics.length)];
    questions.push(generateQuestionForTopic(randomTopic.topic, "medium"));
  }
  
  return questions;
}

// Generate question for a topic
function generateQuestionForTopic(topic, difficulty) {
  let num1, num2, answer, question;
  
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
      num2 = Math.floor(Math.random() * num1) + 1;
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
      num1 = num2 * answer;
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
