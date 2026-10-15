# Cloud Functions: صلاحيات الغرف وحذف الرسائل

هذه الوظائف تستخدم Admin SDK من الخادم، لذلك لا تمنح التطبيق صلاحية تعديل العضوية أو حذف الرسائل لدى الجميع مباشرة.

## النشر
1. أنشئ مشروع Firebase واربطه من جذر المشروع: `firebase use --add`.
2. تحقق من إعداد Cloud Functions وخطة Firebase المناسبة.
3. من مجلد `functions` شغّل `npm install`.
4. نفّذ `firebase deploy --only functions`.
5. من Firebase Console > Firestore Rules انشر ملف `firestore.rules` من جذر المشروع، وانشر `storage.rules` أيضاً بعد مراجعتها.

## الوظائف
- `addRoomMember`: مشرف الغرفة فقط.
- `removeRoomMember`: مشرف الغرفة فقط، ولا يمكنه إزالة نفسه بوصفه المالك.
- `toggleRoomMute`: المشرف فقط، لتغيير حالة كتم عضو.
- `deleteMessageForEveryone`: لا يسمح إلا للمرسل بحذف رسالته لدى الجميع.
- `notifyNewMessage`: إشعار FCM للمستلمين.

## تحذير
قواعد Firestore ليست بديلاً عن اختبار أمني شامل. اختبر قواعد القراءة والكتابة باستخدام Firebase Emulator Suite، خصوصاً إنشاء غرف جديدة وإنشاء وثيقة chats ومزامنة members. Cloud Functions قد تتطلب تفعيل الفوترة حسب إعداد مشروعك.


## وظائف لوحة التحكم
- `adminGetOverview`: أعداد إحصائية.
- `adminListUsers` / `adminListRooms` / `adminListReports`: قوائم الإدارة، للمدير فقط.
- `adminSetUserBan`: تعطيل/إعادة تفعيل حساب.
- `adminDeleteRoom`: حذف غرفة ورسائلها وملفاتها.
- `adminResolveReport`: تحديث حالة بلاغ.
- `adminBroadcast`: إرسال إشعار عام.
- `submitUserReport`: إرسال بلاغ من داخل المحادثة.

لمنح صلاحية المدير راجع `admin-dashboard/README_AR.md` واستخدم `node set_admin.js USER_UID` مع Application Default Credentials/متغير `GOOGLE_APPLICATION_CREDENTIALS`.
