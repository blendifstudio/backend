# Backend MVC Structure

## Overview
The backend has been restructured to follow the **Model-View-Controller (MVC)** pattern for better organization, maintainability, and separation of concerns.

## Directory Structure

```
backend/
├── models/                    # Data models (MongoDB schemas)
│   ├── User.js               # User model with profile fields
│   └── Game.js               # Game/assessment model
│
├── controllers/               # Business logic
│   ├── authController.js     # Authentication (signup, login, logout, profile)
│   ├── gameController.js     # Game operations (save, history, leaderboard)
│   ├── practiceController.js # Practice sessions (start, save, history, recommendations)
│   ├── analyticsController.js # Analytics (topics, risk scores, mistake patterns)
│   └── teacherController.js  # Teacher dashboard (students, class stats, heatmap)
│
├── routes/                    # API route definitions
│   ├── authRoutes.js         # /api/* auth routes
│   ├── gameRoutes.js         # /api/game/* routes
│   ├── practiceRoutes.js     # /api/practice/* routes
│   ├── analyticsRoutes.js    # /api/analytics/* routes
│   └── teacherRoutes.js      # /api/teacher/* routes
│
├── utils/                     # Helper functions
│   └── practiceHelper.js     # Practice generation, mistake pattern analysis
│
├── server.js                  # Main server file (clean MVC structure)
└── server-old.js              # Backup of original monolithic server
```

## API Endpoints

### Authentication Routes (`/api/`)
- `POST /api/signup` - User registration
- `POST /api/login` - User authentication
- `POST /api/logout` - User logout
- `GET /api/profile` - Get current user profile
- `PUT /api/profile` - Update user profile
- `GET /api/profile/:userId` - Get specific user profile (teachers only)

### Game Routes (`/api/game/`)
- `POST /api/game/save` - Save game results
- `GET /api/game/history` - Get user's game history

### Practice Routes (`/api/practice/`)
- `GET /api/practice/recommendations` - Get personalized practice recommendations
- `POST /api/practice/start` - Start a practice session
- `POST /api/practice/save` - Save practice session results
- `GET /api/practice/history` - Get practice session history

### Analytics Routes (`/api/analytics/`)
- `GET /api/analytics/topics` - Get topic-wise performance analytics
- `GET /api/analytics/deficiencies` - Get learning deficiencies
- `GET /api/analytics/mistake-patterns` - Get mistake pattern analysis
- `GET /api/analytics/risk-score` - Get student risk assessment

### Teacher Routes (`/api/teacher/`)
- `GET /api/teacher/students` - Get all students
- `GET /api/teacher/students/:studentId/deficiencies` - Get student deficiencies
- `GET /api/teacher/students/:studentId/cognitive-load` - Get cognitive load analysis
- `GET /api/teacher/students/:studentId/mistake-patterns` - Get student mistake patterns
- `GET /api/teacher/students/:studentId/risk-score` - Get student risk score
- `GET /api/teacher/analytics/class` - Get class-wide analytics
- `GET /api/teacher/analytics/heatmap` - Get performance heatmap

### Other Routes
- `GET /api/leaderboard` - Get global leaderboard
- `GET /health` - Server health check

## Key Features

### 1. Separation of Concerns
- **Models**: Database schemas and data structure
- **Controllers**: Business logic and data processing
- **Routes**: API endpoint definitions and middleware
- **Utils**: Reusable helper functions

### 2. Middleware
- `ensureAuthenticated`: Protects routes requiring login
- `ensureTeacher`: Restricts access to teacher-only endpoints
- Session management with MongoDB store
- Passport.js for authentication

### 3. Role-Based Access Control
- Student profile with learning data (grades, points, badges, streaks)
- Teacher profile with professional credentials
- Different data access levels based on role

## Database Models

### User Model
```javascript
{
  username, email, passwordHash, role,
  profile: { firstName, lastName, avatar, bio, phone, dateOfBirth, gender },
  studentInfo: { grade, school, parentEmail, learningGoals, totalPoints, badges, streak },
  teacherInfo: { subject, school, qualification, experience, classesTeaching },
  lastLogin, isActive, createdAt, updatedAt
}
```

### Game Model
```javascript
{
  userId, difficulty, score, timeline, wrongAttempts,
  isPractice, totalTime, questionsAnswered, date
}
```

## Running the Server

```bash
# Start the server
npm start

# The server will run on http://localhost:3001
```

## Migration Notes

- **Original server.js** → Backed up as `server-old.js` (1903 lines)
- **New server.js** → Clean MVC structure (150 lines)
- All functionality preserved and organized into proper MVC pattern
- Legacy endpoints maintained for backward compatibility

## Future Enhancements

- Add more comprehensive deficiency detection logic
- Expand cognitive load analysis
- Implement caching for frequently accessed data
- Add API documentation with Swagger/OpenAPI
- Add unit tests for controllers
- Implement rate limiting
- Add API versioning
