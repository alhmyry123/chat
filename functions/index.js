const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();

function requireVerified(request) {
  if (!request.auth || request.auth.token.email_verified !== true) {
    throw new HttpsError('unauthenticated', 'يجب تسجيل الدخول ببريد إلكتروني مفعّل.');
  }
  return request.auth.uid;
}
async function getRoomOwner(roomId, uid) {
  const ref = db.doc(`rooms/${roomId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'الغرفة غير موجودة.');
  if (snap.data().ownerId !== uid) throw new HttpsError('permission-denied', 'هذه العملية للمشرف فقط.');
  return { ref, data: snap.data() };
}

exports.addRoomMember = onCall(async (request) => {
  const uid = requireVerified(request);
  const { roomId, memberUid } = request.data || {};
  if (typeof roomId !== 'string' || typeof memberUid !== 'string' || !roomId || !memberUid) {
    throw new HttpsError('invalid-argument', 'roomId و memberUid مطلوبان.');
  }
  const { ref, data } = await getRoomOwner(roomId, uid);
  if (memberUid === uid) return { ok: true };
  await ref.update({ members: FieldValue.arrayUnion(memberUid) });
  await db.doc(`chats/${roomId}`).set({
    members: FieldValue.arrayUnion(memberUid),
    isRoom: true,
    title: data.name,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true };
});

exports.removeRoomMember = onCall(async (request) => {
  const uid = requireVerified(request);
  const { roomId, memberUid } = request.data || {};
  if (typeof roomId !== 'string' || typeof memberUid !== 'string' || !roomId || !memberUid) {
    throw new HttpsError('invalid-argument', 'roomId و memberUid مطلوبان.');
  }
  const { ref, data } = await getRoomOwner(roomId, uid);
  if (memberUid === data.ownerId) throw new HttpsError('failed-precondition', 'لا يمكن إزالة مشرف الغرفة.');
  await ref.update({ members: FieldValue.arrayRemove(memberUid), mutedMembers: FieldValue.arrayRemove(memberUid) });
  await db.doc(`chats/${roomId}`).update({ members: FieldValue.arrayRemove(memberUid) });
  return { ok: true };
});

exports.toggleRoomMute = onCall(async (request) => {
  const uid = requireVerified(request);
  const { roomId, memberUid, muted } = request.data || {};
  if (typeof roomId !== 'string' || typeof memberUid !== 'string' || typeof muted !== 'boolean') {
    throw new HttpsError('invalid-argument', 'roomId و memberUid و muted مطلوبة.');
  }
  const { ref, data } = await getRoomOwner(roomId, uid);
  if (!data.members.includes(memberUid)) throw new HttpsError('failed-precondition', 'المستخدم ليس عضواً في الغرفة.');
  await ref.update({ mutedMembers: muted ? FieldValue.arrayUnion(memberUid) : FieldValue.arrayRemove(memberUid) });
  return { ok: true };
});

exports.deleteMessageForEveryone = onCall(async (request) => {
  const uid = requireVerified(request);
  const { chatId, messageId } = request.data || {};
  if (typeof chatId !== 'string' || typeof messageId !== 'string') {
    throw new HttpsError('invalid-argument', 'chatId و messageId مطلوبان.');
  }
  const chatSnap = await db.doc(`chats/${chatId}`).get();
  if (!chatSnap.exists || !chatSnap.data().members.includes(uid)) {
    throw new HttpsError('permission-denied', 'لست عضواً في هذه المحادثة.');
  }
  const messageRef = db.doc(`chats/${chatId}/messages/${messageId}`);
  const messageSnap = await messageRef.get();
  if (!messageSnap.exists) throw new HttpsError('not-found', 'الرسالة غير موجودة.');
  if (messageSnap.data().senderId !== uid) {
    throw new HttpsError('permission-denied', 'يمكن للمرسل فقط حذف الرسالة لدى الجميع.');
  }
  await messageRef.update({
    deletedForEveryone: true,
    text: 'تم حذف هذه الرسالة',
    url: FieldValue.delete(),
    fileName: FieldValue.delete(),
    mimeType: FieldValue.delete(),
    size: FieldValue.delete(),
    type: 'text',
    deletedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.notifyNewMessage = onDocumentCreated('chats/{chatId}/messages/{messageId}', async (event) => {
  const msg = event.data?.data();
  if (!msg) return;
  const chat = (await db.doc(`chats/${event.params.chatId}`).get()).data();
  if (!chat || !Array.isArray(chat.members)) return;
  const recipients = chat.members.filter(uid => uid !== msg.senderId);
  if (!recipients.length) return;
  const users = await Promise.all(recipients.map(uid => db.doc(`users/${uid}`).get()));
  const tokens = users.flatMap(u => {
    const d = u.data();
    return Array.isArray(d?.fcmTokens) ? d.fcmTokens : [];
  });
  if (!tokens.length) return;
  const response = await getMessaging().sendEachForMulticast({
    tokens,
    notification: { title: chat.title || 'ChatPro', body: msg.text || msg.fileName || 'رسالة جديدة' },
    data: { chatId: event.params.chatId, type: msg.type || 'text' },
    android: { priority: 'high', notification: { channelId: 'chatpro_messages' } }
  });
  const invalid = [];
  response.responses.forEach((r, i) => {
    if (!r.success && ['messaging/invalid-registration-token','messaging/registration-token-not-registered'].includes(r.error?.code)) invalid.push(tokens[i]);
  });
  if (invalid.length) {
    for (const u of users) {
      const d = u.data();
      if (Array.isArray(d?.fcmTokens)) await u.ref.update({ fcmTokens: d.fcmTokens.filter(t => !invalid.includes(t)) });
    }
  }
});


// ---------------- Admin dashboard (all privileged reads/writes stay on the server) ----------------
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');

function callableSafe(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(callableSafe);
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, callableSafe(item)]));
  }
  return value;
}

function requireAdmin(request) {
  const uid = requireVerified(request);
  if (request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'هذه العملية متاحة لمدير ChatPro فقط.');
  }
  return uid;
}

exports.adminGetOverview = onCall(async (request) => {
  requireAdmin(request);
  const [users, rooms, chats, reports, messages] = await Promise.all([
    db.collection('users').count().get(),
    db.collection('rooms').count().get(),
    db.collection('chats').count().get(),
    db.collection('reports').count().get(),
    db.collectionGroup('messages').count().get(),
  ]);
  const banned = await db.collection('users').where('isBanned', '==', true).count().get();
  return {
    users: users.data().count,
    rooms: rooms.data().count,
    chats: chats.data().count,
    reports: reports.data().count,
    messages: messages.data().count,
    bannedUsers: banned.data().count,
    generatedAt: new Date().toISOString(),
  };
});

exports.adminListUsers = onCall(async (request) => {
  requireAdmin(request);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 200, 1), 500);
  const snap = await db.collection('users').limit(limit).get();
  return { users: snap.docs.map(d => callableSafe({ ...d.data(), uid: d.id })) };
});

exports.adminListRooms = onCall(async (request) => {
  requireAdmin(request);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 200, 1), 500);
  const snap = await db.collection('rooms').limit(limit).get();
  return { rooms: snap.docs.map(d => callableSafe({ id: d.id, ...d.data() })) };
});

exports.adminListReports = onCall(async (request) => {
  requireAdmin(request);
  const limit = Math.min(Math.max(Number(request.data?.limit) || 200, 1), 500);
  const snap = await db.collection('reports').limit(limit).get();
  return { reports: snap.docs.map(d => callableSafe({ id: d.id, ...d.data() })) };
});

exports.submitUserReport = onCall(async (request) => {
  const uid = requireVerified(request);
  const { reportedUid, reason, details, chatId } = request.data || {};
  if (typeof reportedUid !== 'string' || !reportedUid || reportedUid === uid || typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 120) {
    throw new HttpsError('invalid-argument', 'حدد المستخدم وسبب البلاغ (3 إلى 120 حرفاً).');
  }
  const safeDetails = typeof details === 'string' ? details.trim().slice(0, 1000) : '';
  await db.collection('reports').add({
    reporterUid: uid,
    reportedUid,
    reason: reason.trim(),
    details: safeDetails,
    chatId: typeof chatId === 'string' ? chatId.slice(0, 180) : null,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

exports.adminSetUserBan = onCall(async (request) => {
  requireAdmin(request);
  const { uid, banned } = request.data || {};
  if (typeof uid !== 'string' || !uid || typeof banned !== 'boolean') {
    throw new HttpsError('invalid-argument', 'uid و banned مطلوبان.');
  }
  if (uid === request.auth.uid && banned) throw new HttpsError('failed-precondition', 'لا يمكنك حظر حساب المدير الذي تستخدمه.');
  const userRecord = await getAuth().getUser(uid);
  const claims = { ...(userRecord.customClaims || {}) };
  if (claims.admin === true && banned) throw new HttpsError('failed-precondition', 'أزل صلاحية المدير أولاً قبل حظر هذا الحساب.');
  await getAuth().updateUser(uid, { disabled: banned });
  await getAuth().setCustomUserClaims(uid, { ...claims, banned });
  await db.doc(`users/${uid}`).set({ isBanned: banned, status: banned ? 'suspended' : 'active', statusUpdatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return { ok: true, banned };
});

exports.adminDeleteRoom = onCall(async (request) => {
  requireAdmin(request);
  const { roomId } = request.data || {};
  if (typeof roomId !== 'string' || !roomId) throw new HttpsError('invalid-argument', 'roomId مطلوب.');
  const roomRef = db.doc(`rooms/${roomId}`);
  const roomSnap = await roomRef.get();
  if (!roomSnap.exists) throw new HttpsError('not-found', 'الغرفة غير موجودة.');
  const chatRef = db.doc(`chats/${roomId}`);
  await db.recursiveDelete(chatRef);
  await roomRef.delete();
  try { await getStorage().bucket().deleteFiles({ prefix: `chat_uploads/${roomId}/` }); } catch (e) { console.warn('Could not clean room files:', e.message); }
  return { ok: true };
});

exports.adminResolveReport = onCall(async (request) => {
  requireAdmin(request);
  const { reportId, status, adminNote } = request.data || {};
  if (typeof reportId !== 'string' || !reportId || !['resolved', 'dismissed', 'open'].includes(status)) {
    throw new HttpsError('invalid-argument', 'reportId أو status غير صحيح.');
  }
  const ref = db.doc(`reports/${reportId}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'البلاغ غير موجود.');
  await ref.update({ status, adminNote: typeof adminNote === 'string' ? adminNote.slice(0, 500) : '', reviewedBy: request.auth.uid, reviewedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

exports.adminBroadcast = onCall(async (request) => {
  requireAdmin(request);
  const { title, body } = request.data || {};
  if (typeof title !== 'string' || title.trim().length < 2 || title.length > 80 || typeof body !== 'string' || body.trim().length < 2 || body.length > 500) {
    throw new HttpsError('invalid-argument', 'العنوان 2–80 حرفاً والرسالة 2–500 حرف.');
  }
  const users = await db.collection('users').limit(1000).get();
  const tokens = [...new Set(users.docs.filter(d => d.data().isBanned !== true).flatMap(d => Array.isArray(d.data().fcmTokens) ? d.data().fcmTokens : []))];
  let sent = 0;
  for (let i = 0; i < tokens.length; i += 500) {
    const batch = tokens.slice(i, i + 500);
    const result = await getMessaging().sendEachForMulticast({ tokens: batch, notification: { title: title.trim(), body: body.trim() }, data: { type: 'announcement' } });
    sent += result.successCount;
  }
  await db.collection('announcements').add({ title: title.trim(), body: body.trim(), sentCount: sent, createdBy: request.auth.uid, createdAt: FieldValue.serverTimestamp() });
  return { ok: true, tokenCount: tokens.length, sent };
});
