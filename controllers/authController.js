import bcrypt from "bcrypt";
import User from "../models/User.js";

// Signup controller
export const signup = async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  // Input sanitization
  const cleanUsername = String(username).trim().slice(0, 50);
  const cleanEmail    = String(email).trim().toLowerCase().slice(0, 200);

  // Password requirements: min 8 chars, at least one letter and one number
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    return res.status(400).json({ error: "Password must contain at least one letter and one number" });

  // Username: alphanumeric + underscore only
  if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername))
    return res.status(400).json({ error: "Username may only contain letters, numbers, and underscores" });

  // Validate role
  const userRole = role && ["student", "teacher"].includes(role) ? role : "student";

  try {
    const existing = await User.findOne({ username: cleanUsername });
    if (existing) return res.status(409).json({ error: "Username already taken" });

    const hash = await bcrypt.hash(password, 12);
    
    // Initialize user with empty profile structures
    const userData = { 
      username: cleanUsername, 
      email: cleanEmail, 
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
};

// Login controller
export const login = async (req, res, next, passport) => {
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
};

// Logout controller
export const logout = (req, res) => {
  req.logout(() => res.json({ message: "Logged out" }));
};

// Get current user profile
export const getProfile = (req, res) => {
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
};

// Update profile
export const updateProfile = async (req, res) => {
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
};

// Get user profile by ID (for teachers viewing student profiles)
export const getUserProfile = async (req, res) => {
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
};
