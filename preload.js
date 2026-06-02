const { contextBridge, ipcRenderer } = require('electron');
const { initializeApp, getApps } = require('firebase/app');
const { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  signOut 
} = require('firebase/auth');
const { 
  getFirestore, 
  collection, 
  addDoc, 
  doc, 
  getDoc, 
  getDocs, 
  updateDoc, 
  setDoc 
} = require('firebase/firestore');

let cachedConfig = null;

async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    cachedConfig = await ipcRenderer.invoke('get-firebase-config');
  } catch (e) {
    console.error('Failed to get firebase config via IPC:', e);
  }
  return cachedConfig;
}

let firebasePromise;

function normalizeDate(value) {
  return value || new Date().toISOString().slice(0, 10);
}

function calculateSubtotal(items) {
  return (items || []).reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
}

function buildInvoiceNumber(date, docId) {
  const day = new Date(date);
  const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  return `INV-${ymd}-${String(docId).replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()}`;
}

async function getFirebaseState() {
  const config = await loadConfig();
  if (!config) {
    throw new Error('Firebase is not configured yet. Please create a firebase-config.json file.');
  }

  if (!firebasePromise) {
    firebasePromise = (async () => {
      const app = getApps().length ? getApps()[0] : initializeApp(config);
      const auth = getAuth(app);
      const db = getFirestore(app, 'default');
      return { app, auth, db };
    })();
  }

  return firebasePromise;
}

async function getUserContext() {
  const state = await getFirebaseState();
  const user = state.auth.currentUser;
  if (!user) {
    throw new Error('Please log in first.');
  }
  return { ...state, user };
}

async function signIn(email, password) {
  const state = await getFirebaseState();
  const credential = await signInWithEmailAndPassword(state.auth, email, password);
  return {
    idToken: await credential.user.getIdToken(),
    localId: credential.user.uid,
    email: credential.user.email
  };
}

async function signUp(email, password) {
  const state = await getFirebaseState();
  const credential = await createUserWithEmailAndPassword(state.auth, email, password);
  return {
    idToken: await credential.user.getIdToken(),
    localId: credential.user.uid,
    email: credential.user.email
  };
}

async function signOutUser() {
  const state = await getFirebaseState();
  await signOut(state.auth);
}

async function sendPasswordReset(email) {
  const state = await getFirebaseState();
  await sendPasswordResetEmail(state.auth, email);
}

async function saveShopProfile(profileData) {
  const { db, user } = await getUserContext();
  await setDoc(doc(db, 'users', user.uid, 'settings', 'profile'), profileData);
}

async function getShopProfile() {
  const { db, user } = await getUserContext();
  const snap = await getDoc(doc(db, 'users', user.uid, 'settings', 'profile'));
  return snap.exists() ? snap.data() : null;
}

async function saveInvoice(payload) {
  const { db, user } = await getUserContext();
  const date = normalizeDate(payload.date);
  const items = Array.isArray(payload.items) ? payload.items : [];
  const taxPct = Number(payload.taxPct) || 0;
  const subtotal = Number(payload.subtotal);
  const calculatedSubtotal = Number.isFinite(subtotal) ? subtotal : calculateSubtotal(items);
  const tax = calculatedSubtotal * (taxPct / 100);
  const total = calculatedSubtotal + tax;
  const invNoProvided = Boolean(payload.invNo && String(payload.invNo).trim());

  const record = {
    invNo: invNoProvided ? String(payload.invNo).trim() : '',
    date,
    billTo: payload.billTo || '',
    items,
    taxPct,
    subtotal: calculatedSubtotal,
    tax,
    total,
    createdAt: new Date().toISOString(),
  };

  const ref = await addDoc(collection(db, 'users', user.uid, 'invoices'), record);
  if (!invNoProvided) {
    record.invNo = buildInvoiceNumber(date, ref.id);
    await updateDoc(doc(db, 'users', user.uid, 'invoices', ref.id), { invNo: record.invNo });
  }

  return { id: ref.id, ...record };
}

async function listInvoices(filter = {}) {
  const { db, user } = await getUserContext();
  const snapshot = await getDocs(collection(db, 'users', user.uid, 'invoices'));
  const rows = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

  return rows
    .filter((row) => {
      let ok = true;
      if (filter.from) ok = ok && String(row.date || '') >= filter.from;
      if (filter.to) ok = ok && String(row.date || '') <= filter.to;
      if (filter.invNo) ok = ok && String(row.invNo || '').includes(String(filter.invNo));
      return ok;
    })
    .sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate !== 0) return byDate;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
}

async function getInvoice(id) {
  const { db, user } = await getUserContext();
  const snapshot = await getDoc(doc(db, 'users', user.uid, 'invoices', String(id)));
  if (!snapshot.exists()) return null;
  return { id: snapshot.id, ...snapshot.data() };
}

async function getFirebaseStatus() {
  const config = await loadConfig();
  if (!config) {
    return { configured: false, connected: false, userId: null, email: null };
  }

  try {
    const state = await getFirebaseState();
    const user = state.auth.currentUser;
    return { 
      configured: true, 
      connected: Boolean(user), 
      userId: user ? user.uid : null, 
      email: user ? user.email : null 
    };
  } catch (e) {
    return { configured: true, connected: false, userId: null, email: null };
  }
}

contextBridge.exposeInMainWorld('api', {
  signIn,
  signUp,
  signOutUser,
  sendPasswordReset,
  saveShopProfile,
  getShopProfile,
  saveInvoice,
  listInvoices,
  getInvoice,
  getFirebaseStatus,
});
