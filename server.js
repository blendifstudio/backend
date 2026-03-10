import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import passport from "passport";
import session from "express-session";
import LocalStrategy from "passport-local";
import MongoStore from "connect-mongo";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";

import User from "./models/User.js";

// Import routes
import authRoutes from "./routes/authRoutes.js";
import gameRoutes from "./routes/gameRoutes.js";
import practiceRoutes from "./routes/practiceRoutes.js";
import analyticsRoutes from "./routes/analyticsRoutes.js";
import teacherRoutes from "./routes/teacherRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";

dotenv.config();

// ── Environment validation ────────────────────────────────────────────────────
const REQUIRED_ENV = ["MONGODB_URI", "SESSION_SECRET"];
const missingEnv = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingEnv.join(", ")}`);
  console.error("   Create a .env file — see .env.example for required keys.");
  process.exit(1);
}

const app = express();

// ── CORS configuration ────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",").map(o => o.trim())
  : ["http://localhost:5173", "http://localhost:5174"];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS policy: origin ${origin} not allowed`));
  },
  credentials: true
}));

app.use(express.json({ limit: "10kb" })); // Limit body size

// MongoDB connection
mongoose.connect(process.env.MONGODB_URI);
const db = mongoose.connection;
db.on("error", console.error.bind(console, "MongoDB connection error:"));
db.once("open", () => console.log("✅ Connected to MongoDB"));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax"
  }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport local strategy
passport.use(new LocalStrategy(async (username, password, done) => {
  try {
    const user = await User.findOne({ username });
    if (!user) return done(null, false, { message: "Incorrect username" });

    // Normal password login
    if (user.passwordHash) {
      const match = await bcrypt.compare(password, user.passwordHash);
      if (match) return done(null, user);
    }

    // PIN login for teacher-created students
    if (user.pin) {
      const pinMatch = await bcrypt.compare(password, user.pin);
      if (pinMatch) return done(null, user);
    }

    return done(null, false, { message: "Incorrect password" });
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

// Make passport available to routes
app.locals.passport = passport;

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 20,                    // max 20 auth attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again in 15 minutes." }
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});

// ── CSRF origin check for mutating requests ───────────────────────────────────
app.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    const origin = req.get("Origin") || req.get("Referer") || "";
    const isAllowed = !origin || allowedOrigins.some(o => origin.startsWith(o));
    if (!isAllowed) {
      return res.status(403).json({ error: "Forbidden: invalid origin" });
    }
  }
  next();
});

// ── API Routes ────────────────────────────────────────────────────────────────
// authLimiter only on the two mutating auth paths; everything else uses apiLimiter
app.use("/api/signup", authLimiter);
app.use("/api/login",  authLimiter);
app.use("/api", apiLimiter, authRoutes);
app.use("/api/game", apiLimiter, gameRoutes);
app.use("/api/practice", apiLimiter, practiceRoutes);
app.use("/api/analytics", apiLimiter, analyticsRoutes);
app.use("/api/teacher", apiLimiter, teacherRoutes);
app.use("/api/ai", apiLimiter, aiRoutes);

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running" });
});

// ── Global error handler ──────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack || err.message);
  const status = err.status || err.statusCode || 500;
  const message = process.env.NODE_ENV === "production"
    ? "An unexpected error occurred"
    : err.message || "Internal server error";
  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
