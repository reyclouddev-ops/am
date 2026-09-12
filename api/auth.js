const mongoose = require("mongoose")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")

const UserSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 32
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true
  },
  role: {
    type: String,
    enum: ["user", "admin", "creator"],
    default: "user"
  },
  ip_address: {
    type: String,
    default: null
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
})

const SessionSchema = new mongoose.Schema({
  tokenHash: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
})

SessionSchema.index({
  expiresAt: 1
}, {
  expireAfterSeconds: 0
})

const User = mongoose.models.User || mongoose.model("User", UserSchema)
const Session = mongoose.models.Session || mongoose.model("Session", SessionSchema)

const SESSION_COOKIE = "rey_session"
const SESSION_DAYS = 7

function hashSessionToken(token) {
  return crypto
    .createHash("sha256")
    .update(token)
    .digest("hex")
}

function createSessionToken() {
  return crypto.randomBytes(48).toString("hex")
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"]

  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim()
  }

  return (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown"
  )
}

function parseCookies(req) {
  const header = req.headers.cookie

  if (!header) {
    return {}
  }

  const cookies = {}

  for (const part of header.split(";")) {
    const index = part.indexOf("=")

    if (index === -1) {
      continue
    }

    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()

    cookies[key] = decodeURIComponent(value)
  }

  return cookies
}

function setSessionCookie(res, token, maxAge) {
  const secure = process.env.NODE_ENV === "production"

  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ")

  res.setHeader("Set-Cookie", cookie)
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production"

  const cookie = [
    `${SESSION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : ""
  ]
    .filter(Boolean)
    .join("; ")

  res.setHeader("Set-Cookie", cookie)
}

async function createSession(userId) {
  const token = createSessionToken()
  const tokenHash = hashSessionToken(token)

  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  )

  await Session.create({
    tokenHash,
    userId,
    expiresAt
  })

  return {
    token,
    expiresAt
  }
}

async function getSessionUser(req) {
  const cookies = parseCookies(req)
  const token = cookies[SESSION_COOKIE]

  if (!token) {
    return null
  }

  const tokenHash = hashSessionToken(token)

  const session = await Session.findOne({
    tokenHash,
    expiresAt: {
      $gt: new Date()
    }
  })

  if (!session) {
    return null
  }

  const user = await User.findById(session.userId).lean()

  if (!user) {
    await Session.deleteOne({
      _id: session._id
    })

    return null
  }

  return {
    user,
    session
  }
}

async function requireAuth(req, res, next) {
  try {
    const result = await getSessionUser(req)

    if (!result) {
      return res.status(401).json({
        status: false,
        message: "Unauthorized"
      })
    }

    req.user = result.user
    req.sessionData = result.session

    next()
  } catch (error) {
    console.error("AUTH ERROR:", error)

    return res.status(500).json({
      status: false,
      message: "Authentication error"
    })
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized"
    })
  }

  if (
    req.user.role !== "admin" &&
    req.user.role !== "creator"
  ) {
    return res.status(403).json({
      status: false,
      message: "Admin access required"
    })
  }

  next()
}

function requireCreator(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      status: false,
      message: "Unauthorized"
    })
  }

  if (req.user.role !== "creator") {
    return res.status(403).json({
      status: false,
      message: "Creator access required"
    })
  }

  next()
}

async function verifyTurnstile(token, remoteip) {
  if (!token) {
    return {
      success: false,
      reason: "missing-token"
    }
  }

  const secret = process.env.TURNSTILE_SECRET_KEY

  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY belum diset")

    return {
      success: false,
      reason: "server-config"
    }
  }

  try {
    const body = new URLSearchParams()

    body.append("secret", secret)
    body.append("response", token)

    if (remoteip) {
      body.append("remoteip", remoteip)
    }

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body
      }
    )

    if (!response.ok) {
      return {
        success: false,
        reason: "turnstile-http-error"
      }
    }

    const result = await response.json()

    return {
      success: result.success === true,
      result
    }
  } catch (error) {
    console.error("TURNSTILE ERROR:", error)

    return {
      success: false,
      reason: "turnstile-request-error"
    }
  }
}

async function requireTurnstile(req, res, next) {
  const token =
    req.body?.turnstileToken ||
    req.body?.["cf-turnstile-response"] ||
    req.headers["x-turnstile-token"]

  const result = await verifyTurnstile(
    token,
    getClientIp(req)
  )

  if (!result.success) {
    return res.status(403).json({
      status: false,
      message: "Turnstile verification failed"
    })
  }

  req.turnstile = result.result

  next()
}

function sanitizeUser(user) {
  if (!user) {
    return null
  }

  return {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    created_at: user.created_at,
    updated_at: user.updated_at
  }
}

async function registerUser({
  username,
  email,
  password,
  ip
}) {
  username = String(username || "").trim()
  email = String(email || "").trim().toLowerCase()
  password = String(password || "")

  if (!username || !email || !password) {
    throw new Error("Username, email, dan password wajib diisi")
  }

  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) {
    throw new Error("Username tidak valid")
  }

  if (password.length < 8 || password.length > 128) {
    throw new Error("Password harus 8-128 karakter")
  }

  const existing = await User.findOne({
    $or: [
      {
        username
      },
      {
        email
      }
    ]
  })

  if (existing) {
    if (
      existing.username.toLowerCase() ===
      username.toLowerCase()
    ) {
      throw new Error("Username sudah digunakan")
    }

    throw new Error("Email sudah digunakan")
  }

  const passwordHash = await bcrypt.hash(
    password,
    12
  )

  const user = await User.create({
    username,
    email,
    password: passwordHash,
    role: "user",
    ip_address: ip
  })

  return user
}

async function loginUser({
  username,
  password
}) {
  username = String(username || "").trim()
  password = String(password || "")

  if (!username || !password) {
    return null
  }

  const user = await User.findOne({
    $or: [
      {
        username: username
      },
      {
        email: username.toLowerCase()
      }
    ]
  })

  if (!user) {
    return null
  }

  const valid = await bcrypt.compare(
    password,
    user.password
  )

  if (!valid) {
    return null
  }

  return user
}

async function destroySession(req, res) {
  const cookies = parseCookies(req)
  const token = cookies[SESSION_COOKIE]

  if (token) {
    await Session.deleteOne({
      tokenHash: hashSessionToken(token)
    })
  }

  clearSessionCookie(res)
}

module.exports = {
  User,
  Session,
  SESSION_COOKIE,
  getClientIp,
  createSession,
  getSessionUser,
  requireAuth,
  requireAdmin,
  requireCreator,
  verifyTurnstile,
  requireTurnstile,
  sanitizeUser,
  registerUser,
  loginUser,
  destroySession
}