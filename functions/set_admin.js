// الاستخدام: GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json" node set_admin.js USER_UID
// شغّل هذا الملف من جهاز المدير فقط. لا ترفع ملف service-account.json إلى GitHub.
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

async function main() {
  const uid = process.argv[2];
  if (!uid) throw new Error('اكتب UID للحساب بعد الأمر.');
  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();
  const user = await auth.getUser(uid);
  if (!user.emailVerified) throw new Error('فعّل البريد الإلكتروني لهذا الحساب أولاً.');
  if (user.disabled) throw new Error('هذا الحساب معطّل؛ أعد تفعيله من Firebase Authentication أولاً.');
  await auth.setCustomUserClaims(uid, { ...(user.customClaims || {}), admin: true, banned: false });
  await getFirestore().doc(`users/${uid}`).set({ email: user.email || null, displayName: user.displayName || user.email || 'ChatPro Admin', isBanned: false, role: 'admin', adminGrantedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`تم منح صلاحية مدير ChatPro للحساب ${user.email || uid}. سجّل الخروج ثم الدخول من جديد.`);
  process.exit(0);
}
main().catch(err => { console.error(err.message || err); process.exit(1); });
