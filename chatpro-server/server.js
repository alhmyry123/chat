const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: [
    "https://chatpro-23013.web.app",
    "https://chatpro-23013.firebaseapp.com"
  ]
}));

app.use(express.json({ limit: "1mb" }));

// لا تضع مفاتيح Firebase السرية داخل الكود أو GitHub.
// سنضبط بيانات الاعتماد بأمان على الخادم قبل تشغيل الإدارة.
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    );

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } else {
    admin.initializeApp();
  }
}

const db = admin.firestore();
const auth = admin.auth();

app.get("/", (req, res) => {
  res.status(200).json({
    app: "ChatPro Server",
    status: "running"
  });
});

// التحقق من تسجيل الدخول وصلاحية المدير.
async function requireAdmin(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer (.+)$/i);

    if (!match) {
      return res.status(401).json({
        error: "يلزم تسجيل الدخول"
      });
    }

    const decoded = await auth.verifyIdToken(match[1], true);

    if (!decoded.email_verified || decoded.admin !== true) {
      return res.status(403).json({
        error: "ليست لديك صلاحية المدير"
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({
      error: "تعذر التحقق من الهوية"
    });
  }
}

app.get("/api/admin/check", requireAdmin, (req, res) => {
  res.json({
    success: true,
    message: "تم التحقق من صلاحية المدير"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`ChatPro server listening on port ${PORT}`);
});
