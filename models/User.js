import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  // Authentication fields
  username: { type: String, unique: true, required: true },
  email:    { type: String, unique: true, sparse: true },  // optional for teacher-created students
  passwordHash: { type: String, default: null },
  pin: { type: String, default: null },                    // 4-digit PIN for teacher-created students (hashed)
  createdByTeacher: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  role: { type: String, enum: ["student", "teacher"], default: "student" },
  
  // Profile fields (common for both roles)
  profile: {
    firstName: { type: String, default: "" },
    lastName: { type: String, default: "" },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "" },
    phone: { type: String, default: "" },
    dateOfBirth: { type: Date, default: null },
    gender: { type: String, enum: ["male", "female", "other", ""], default: "" }
  },
  
  // Student-specific fields
  studentInfo: {
    grade: { type: String, default: "" },
    school: { type: String, default: "" },
    parentEmail: { type: String, default: "" },
    parentPhone: { type: String, default: "" },
    learningGoals: [{ type: String }],
    preferredDifficulty: { type: String, enum: ["easy", "medium", "hard", ""], default: "" },
    totalPoints: { type: Number, default: 0 },
    badges: [{ 
      name: String, 
      description: String, 
      earnedAt: { type: Date, default: Date.now } 
    }],
    streak: {
      current: { type: Number, default: 0 },
      longest: { type: Number, default: 0 },
      lastActivityDate: { type: Date, default: null }
    }
  },
  
  // Teacher-specific fields
  teacherInfo: {
    subject: { type: String, default: "" },
    school: { type: String, default: "" },
    qualification: { type: String, default: "" },
    experience: { type: String, default: "" },
    department: { type: String, default: "" },
    classesTeaching: [{ type: String }],
    students: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  
  // Activity tracking
  lastLogin: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update timestamp on save
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model("User", userSchema);
