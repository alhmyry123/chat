import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';

import {
  getFunctions,
  httpsCallable
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-functions.js';

import { firebaseConfig } from './firebase-config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const functions = getFunctions(app);

const $ = (id) => document.getElementById(id);

const call = (name, data = {}) =>
  httpsCallable(functions, name)(data).then((result) => result.data);

function toast(message) {
  const element = $('toast');

  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');

    setTimeout(() => {
      element.classList.add('hidden');
    }, 4000);
  } else {
    alert(message);
  }
}

async function requireAdmin(user) {
  if (!user) {
    return false;
  }

  if (!user.emailVerified) {
    $('loginError').textContent =
      'يرجى تأكيد البريد الإلكتروني أولاً.';

    await signOut(auth);
    return false;
  }

  const tokenResult = await user.getIdTokenResult(true);

  if (tokenResult.claims.admin !== true) {
    $('loginError').textContent =
      'هذا الحساب ليس لديه صلاحية المدير.';

    await signOut(auth);
    return false;
  }

  return true;
}

async function refreshOverview() {
  const data = await call('adminGetOverview');

  const totalUsers = $('totalUsers');
  const totalRooms = $('totalRooms');
  const totalMessages = $('totalMessages');
  const totalReports = $('totalReports');

  if (totalUsers && data.totalUsers !== undefined) {
    totalUsers.textContent = data.totalUsers;
  }

  if (totalRooms && data.totalRooms !== undefined) {
    totalRooms.textContent = data.totalRooms;
  }

  if (totalMessages && data.totalMessages !== undefined) {
    totalMessages.textContent = data.totalMessages;
  }

  if (totalReports && data.totalReports !== undefined) {
    totalReports.textContent = data.totalReports;
  }
}

async function login() {
  const email = $('email')?.value.trim();
  const password = $('password')?.value;

  if (!email || !password) {
    $('loginError').textContent =
      'أدخل البريد الإلكتروني وكلمة المرور.';
    return;
  }

  $('loginError').textContent = '';

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (error) {
    console.error('خطأ تسجيل الدخول:', error);

    $('loginError').textContent =
      error.code === 'auth/invalid-credential'
        ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة.'
        : error.message || 'تعذر تسجيل الدخول.';
  }
}

async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error('خطأ تسجيل الخروج:', error);
    toast('تعذر تسجيل الخروج.');
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $('loginView')?.classList.remove('hidden');
    $('appView')?.classList.add('hidden');
    return;
  }

  try {
    const isAdmin = await requireAdmin(user);

    if (!isAdmin) {
      return;
    }

    $('loginView')?.classList.add('hidden');
    $('appView')?.classList.remove('hidden');

    if ($('welcome')) {
      $('welcome').textContent =
        'مرحبًا ' + (user.email || 'مدير ChatPro');
    }

    try {
      await refreshOverview();
    } catch (error) {
      console.error('خطأ تحميل الإحصائيات:', error);

      toast(
        'تم تسجيل الدخول، لكن تعذر تحميل الإحصائيات. تحقق من وظائف Firebase الخلفية.'
      );
    }
  } catch (error) {
    console.error('خطأ التحقق من المدير:', error);

    $('loginError').textContent =
      error.message || 'تعذر التحقق من صلاحية المدير.';
  }
});

$('loginForm')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  await login();
});

$('loginButton')?.addEventListener('click', login);
$('logoutButton')?.addEventListener('click', logout);

const refreshButton = $('refreshButton');

refreshButton?.addEventListener('click', async () => {
  try {
    await refreshOverview();
    toast('تم تحديث الإحصائيات.');
  } catch (error) {
    console.error('خطأ تحديث الإحصائيات:', error);
    toast('تعذر تحديث الإحصائيات؛ تحقق من وظائف Firebase.');
  }
});
