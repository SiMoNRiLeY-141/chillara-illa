let firebaseConfig = null;

function getFirestoreBaseUrl() {
  return firebaseConfig ? `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/default/documents` : '';
}
function getSignInUrl() {
  return firebaseConfig ? `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}` : '';
}
function getSignUpUrl() {
  return firebaseConfig ? `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}` : '';
}

async function loadConfig() {
  try {
    const res = await fetch('firebase-config.json');
    if (res.ok) {
      firebaseConfig = await res.json();
      return true;
    }
  } catch (e) {
    console.error("Failed to load local firebase-config.json:", e);
  }
  return false;
}

let firebaseApiPromise;
let firebaseAuthState = null;

function restoreSession() {
  try {
    const cached = localStorage.getItem("firebase.auth");
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && parsed.idToken && parsed.localId) {
        const parts = parsed.idToken.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          const exp = payload.exp * 1000;
          if (exp > Date.now() + 60000) {
            firebaseAuthState = parsed;
            return true;
          }
        }
      }
    }
  } catch (e) {
    console.error("Failed to restore session:", e);
  }
  localStorage.removeItem("firebase.auth");
  firebaseAuthState = null;
  return false;
}

async function getShopProfileRest() {
  try {
    const response = await firestoreRequest(`/users/${firebaseAuthState.localId}/settings/profile`, { method: "GET" });
    return decodeFirestoreDocument(await response.json());
  } catch (e) {
    return null;
  }
}

async function saveShopProfileRest(profileData) {
  await firestoreRequest(`/users/${firebaseAuthState.localId}/settings/profile`, {
    method: "PATCH",
    body: JSON.stringify(encodeFirestoreRecord(profileData))
  });
}

async function getShopProfile() {
  if (window.api && window.api.getShopProfile) {
    return await window.api.getShopProfile();
  }
  return await getShopProfileRest();
}

async function saveShopProfile(profileData) {
  if (window.api && window.api.saveShopProfile) {
    return await window.api.saveShopProfile(profileData);
  }
  return await saveShopProfileRest(profileData);
}

async function sendPasswordResetRest(email) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "PASSWORD_RESET", email }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Password reset failed");
  }
  return await response.json();
}

async function sendPasswordReset(email) {
  if (window.api && window.api.sendPasswordReset) {
    return await window.api.sendPasswordReset(email);
  }
  return await sendPasswordResetRest(email);
}

function updateShopProfileUI(profile) {
  const defaultShopName = "Your Business Name";
  const defaultAddress = "Your Business Address\nCity, State, Zip";
  const defaultPhone = "+91 0000000000";
  const defaultEmail = "info@yourbusiness.com";
  const defaultLogo = "logo.png";
  
  const shopName = profile?.shopName || defaultShopName;
  const address = profile?.address || defaultAddress;
  const phone = profile?.phone || defaultPhone;
  const email = profile?.email || defaultEmail;
  const logo = profile?.logoBase64 || defaultLogo;
  
  $("prevShopName").innerText = shopName;
  $("prevShopAddress").innerHTML = escapeHtml(address).replace(/\n/g, "<br />");
  $("prevShopPhone").innerText = phone;
  $("prevShopEmail").innerText = email;
  $("prevShopLogo").src = logo;
  
  if (profile?.gstNo) {
    $("prevShopGst").innerText = profile.gstNo;
    $("prevShopGstContainer").style.display = "block";
  } else {
    $("prevShopGstContainer").style.display = "none";
  }
}

async function loadAndApplyUserProfile() {
  if (firebaseAuthState && firebaseAuthState.localId) {
    try {
      const profile = await getShopProfile();
      updateShopProfileUI(profile);
    } catch (e) {
      console.error("Failed to load user profile:", e);
      updateShopProfileUI(null);
    }
  } else {
    updateShopProfileUI(null);
  }
}

function checkPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;
  
  const bar = $("strengthBar");
  const label = $("strengthLabel");
  if (!bar || !label) return "unknown";
  
  bar.className = "strength-bar";
  
  if (password.length === 0) {
    bar.style.width = "0";
    label.innerText = "";
    return "empty";
  }
  
  if (score <= 1) {
    bar.classList.add("weak");
    bar.style.width = "33.3%";
    label.innerText = "Weak";
    label.style.color = "var(--danger)";
    return "weak";
  } else if (score <= 3) {
    bar.classList.add("medium");
    bar.style.width = "66.6%";
    label.innerText = "Medium";
    label.style.color = "#f59e0b";
    return "medium";
  } else {
    bar.classList.add("strong");
    bar.style.width = "100%";
    label.innerText = "Strong";
    label.style.color = "var(--success)";
    return "strong";
  }
}

function readImageAsBase64(fileInput) {
  return new Promise((resolve) => {
    const file = fileInput.files[0];
    if (!file) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function openProfileModal() {
  $("profileModal").style.display = "flex";
  
  getShopProfile().then((profile) => {
    $("profShopName").value = profile?.shopName || "";
    $("profAddress").value = profile?.address || "";
    $("profPhone").value = profile?.phone || "";
    $("profEmail").value = profile?.email || firebaseAuthState?.email || "";
    $("profGst").value = profile?.gstNo || "";
    
    const previewImg = $("profLogoPreview");
    if (profile?.logoBase64) {
      previewImg.src = profile.logoBase64;
      previewImg.style.display = "block";
    } else {
      previewImg.src = "";
      previewImg.style.display = "none";
    }
  }).catch(() => {});
}

function closeProfileModal() {
  $("profileModal").style.display = "none";
}

async function loginRest(email, password) {
  if (window.api && window.api.signIn) {
    const state = await window.api.signIn(email, password);
    firebaseAuthState = state;
    localStorage.setItem("firebase.auth", JSON.stringify(firebaseAuthState));
    updateAuthUI();
    return firebaseAuthState;
  }

  const url = getSignInUrl();
  if (!url) throw new Error("Firebase is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Login failed");
  }
  const data = await response.json();
  firebaseAuthState = {
    idToken: data.idToken,
    localId: data.localId,
    email: data.email,
  };
  localStorage.setItem("firebase.auth", JSON.stringify(firebaseAuthState));
  updateAuthUI();
  return firebaseAuthState;
}

async function registerRest(email, password) {
  if (window.api && window.api.signUp) {
    const state = await window.api.signUp(email, password);
    firebaseAuthState = state;
    localStorage.setItem("firebase.auth", JSON.stringify(firebaseAuthState));
    updateAuthUI();
    return firebaseAuthState;
  }

  const url = getSignUpUrl();
  if (!url) throw new Error("Firebase is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.error?.message || "Registration failed");
  }
  const data = await response.json();
  firebaseAuthState = {
    idToken: data.idToken,
    localId: data.localId,
    email: data.email,
  };
  localStorage.setItem("firebase.auth", JSON.stringify(firebaseAuthState));
  updateAuthUI();
  return firebaseAuthState;
}

function logoutRest() {
  localStorage.removeItem("firebase.auth");
  firebaseAuthState = null;
  if (window.api && window.api.signOutUser) {
    window.api.signOutUser();
  }
  updateAuthUI();
  clearForm();
}

function decodeFirestoreValue(value) {
  if (value === null || value === undefined) return null;
  if (Object.prototype.hasOwnProperty.call(value, "stringValue")) return value.stringValue;
  if (Object.prototype.hasOwnProperty.call(value, "integerValue")) return Number(value.integerValue);
  if (Object.prototype.hasOwnProperty.call(value, "doubleValue")) return Number(value.doubleValue);
  if (Object.prototype.hasOwnProperty.call(value, "booleanValue")) return Boolean(value.booleanValue);
  if (Object.prototype.hasOwnProperty.call(value, "timestampValue")) return value.timestampValue;
  if (Object.prototype.hasOwnProperty.call(value, "arrayValue")) {
    const values = value.arrayValue.values || [];
    return values.map(decodeFirestoreValue);
  }
  if (Object.prototype.hasOwnProperty.call(value, "mapValue")) {
    return decodeFirestoreFields(value.mapValue.fields || {});
  }
  return null;
}

function decodeFirestoreFields(fields = {}) {
  const result = {};
  Object.entries(fields).forEach(([key, value]) => {
    if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      Object.defineProperty(result, key, {
        value: decodeFirestoreValue(value),
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  });
  if (typeof result.items === "string") {
    try {
      result.items = JSON.parse(result.items);
    } catch (error) {}
  }
  return result;
}

function encodeFirestoreValue(value) {
  if (Array.isArray(value)) {
    return { stringValue: JSON.stringify(value) };
  }
  if (value === null || value === undefined) {
    return { nullValue: null };
  }
  if (typeof value === "number") {
    return { doubleValue: value };
  }
  if (typeof value === "boolean") {
    return { booleanValue: value };
  }
  if (value instanceof Date) {
    return { timestampValue: value.toISOString() };
  }
  return { stringValue: String(value) };
}

function encodeFirestoreRecord(record) {
  return {
    fields: Object.fromEntries(Object.entries(record).map(([key, value]) => [key, encodeFirestoreValue(value)])),
  };
}

function decodeFirestoreDocument(document) {
  if (!document) return null;
  const data = decodeFirestoreFields(document.fields || {});
  return {
    id: document.name ? document.name.split("/").pop() : null,
    ...data,
  };
}

async function firestoreRequest(path, options = {}) {
  if (!firebaseAuthState) {
    restoreSession();
  }
  if (!firebaseAuthState) {
    throw new Error("Authentication required. Please log in first.");
  }
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${firebaseAuthState.idToken}`);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  const baseUrl = getFirestoreBaseUrl();
  if (!baseUrl) throw new Error("Firebase is not configured.");
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem("firebase.auth");
      firebaseAuthState = null;
      updateAuthUI();
      throw new Error("Session expired. Please log in again.");
    }
    throw new Error(await response.text());
  }
  return response;
}

function ensureFirebaseApi() {
  if (window.api && window.api.saveInvoice) {
    return Promise.resolve(window.api);
  }

  if (firebaseApiPromise) {
    return firebaseApiPromise;
  }

  firebaseApiPromise = (async () => {
    const getInvoicesPath = () => firebaseAuthState ? `/users/${firebaseAuthState.localId}/invoices` : "";

    window.api = {
      async getFirebaseStatus() {
        try {
          restoreSession();
          return {
            configured: Boolean(firebaseConfig),
            connected: Boolean(firebaseAuthState && firebaseAuthState.localId),
            userId: firebaseAuthState ? firebaseAuthState.localId : null,
            email: firebaseAuthState ? firebaseAuthState.email : null,
          };
        } catch (e) {
          throw new Error("Firebase Auth failed: " + e.message);
        }
      },

      async saveInvoice(payload) {
        if (!firebaseAuthState) restoreSession();
        if (!firebaseAuthState) {
          throw new Error("Please log in to save invoices.");
        }
        const items = Array.isArray(payload.items) ? payload.items : [];
        const taxPct = Number(payload.taxPct) || 0;
        const subtotal = Number.isFinite(Number(payload.subtotal))
          ? Number(payload.subtotal)
          : items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
        const tax = subtotal * (taxPct / 100);
        const total = subtotal + tax;
        const date = payload.date || new Date().toISOString().slice(0, 10);
        const invNoProvided = Boolean(payload.invNo && String(payload.invNo).trim());
        const record = {
          invNo: invNoProvided ? String(payload.invNo).trim() : "",
          date,
          billTo: payload.billTo || "",
          items,
          taxPct,
          subtotal,
          tax,
          total,
          createdAt: new Date().toISOString(),
        };

        const createResponse = await firestoreRequest(getInvoicesPath(), {
          method: "POST",
          body: JSON.stringify(encodeFirestoreRecord(record)),
        });
        const createdDocument = decodeFirestoreDocument(await createResponse.json());
        if (!createdDocument || !createdDocument.id) {
          throw new Error("Failed to create invoice document.");
        }

        const documentId = createdDocument.id;
        if (!invNoProvided) {
          const day = new Date(date);
          const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, "0")}${String(day.getDate()).padStart(2, "0")}`;
          record.invNo = `INV-${ymd}-${String(documentId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase()}`;
          await firestoreRequest(`${getInvoicesPath()}/${documentId}?updateMask.fieldPaths=invNo`, {
            method: "PATCH",
            body: JSON.stringify({ fields: { invNo: { stringValue: record.invNo } } }),
          });
        }

        return { id: documentId, ...record };
      },

      async listInvoices(filter = {}) {
        if (!firebaseAuthState) restoreSession();
        if (!firebaseAuthState) {
          throw new Error("Please log in to browse invoices.");
        }
        const queryPath = `/users/${firebaseAuthState.localId}:runQuery`;
        const payloadQuery = { structuredQuery: { from: [{ collectionId: 'invoices' }] } };
        const response = await firestoreRequest(queryPath, {
          method: "POST",
          body: JSON.stringify(payloadQuery)
        });
        const payload = await response.json();
        const rows = payload
          .filter(item => item.document)
          .map(item => decodeFirestoreDocument(item.document))
          .filter(Boolean);
        return rows
          .filter((row) => {
            let ok = true;
            if (filter.from) ok = ok && String(row.date || "") >= filter.from;
            if (filter.to) ok = ok && String(row.date || "") <= filter.to;
            if (filter.invNo) ok = ok && String(row.invNo || "").includes(String(filter.invNo));
            return ok;
          })
          .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
      },

      async getInvoice(id) {
        if (!firebaseAuthState) restoreSession();
        if (!firebaseAuthState) {
          throw new Error("Please log in to retrieve invoices.");
        }
        const response = await firestoreRequest(`${getInvoicesPath()}/${String(id)}`, { method: "GET" });
        return decodeFirestoreDocument(await response.json());
      },
    };

    return window.api;
  })();

  return firebaseApiPromise;
}

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
const $ = id => document.getElementById(id);

function showToast(message, type = 'success') {
  const container = $("toastContainer");
  if (!container) return;
  
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  let icon = "🔔";
  if (type === "success") icon = "✅";
  if (type === "error") icon = "❌";
  if (type === "info") icon = "ℹ️";
  
  const iconSpan = document.createElement("span");
  iconSpan.className = "toast-icon";
  iconSpan.textContent = icon;
  
  const msgSpan = document.createElement("span");
  msgSpan.className = "toast-msg";
  msgSpan.textContent = message;
  
  toast.appendChild(iconSpan);
  toast.appendChild(msgSpan);
  container.appendChild(toast);
  
  setTimeout(() => toast.classList.add("show"), 10);
  
  setTimeout(() => {
    toast.classList.remove("show");
    toast.addEventListener("transitionend", () => toast.remove());
  }, 3500);
}

let items = [];

function format(v) {
  return currency.format(v);
}

function saveState() {
  try {
    localStorage.setItem("invoice.items", JSON.stringify(items));
    localStorage.setItem("invoice.meta", JSON.stringify({ invNo: $("invNo").value, invDate: $("invDate").value, billTo: $("billTo").value, taxPct: $("taxPct").value }));
  } catch (e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem("invoice.items");
    if (raw) items = JSON.parse(raw);
    const meta = JSON.parse(localStorage.getItem("invoice.meta") || "null");
    if (meta) {
      $("invNo").value = meta.invNo || "";
      $("invDate").value = meta.invDate || "";
      $("billTo").value = meta.billTo || "";
      $("taxPct").value = meta.taxPct || 0;
    }
  } catch (e) {
    items = [];
  }
}

function getNextInvoiceNo(invoices) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  
  if (!invoices || invoices.length === 0) {
    return `INV-${ymd}-001`;
  }
  
  // Find the latest invoice number (since listInvoices already sorts by date desc and createdAt desc, the first item is the newest created invoice)
  const latestInv = invoices.find(row => row && row.invNo);
  const latestInvNo = latestInv ? latestInv.invNo : "";
  
  if (!latestInvNo) {
    return `INV-${ymd}-001`;
  }
  
  const match = latestInvNo.match(/(\d+)$/);
  if (match) {
    const numStr = match[1];
    const nextNum = parseInt(numStr, 10) + 1;
    const padded = String(nextNum).padStart(Math.max(numStr.length, 3), '0');
    return `INV-${ymd}-${padded}`;
  }
  
  return `INV-${ymd}-001`;
}

async function fetchNextInvoiceNo() {
  try {
    const api = await ensureFirebaseApi();
    const invoices = await api.listInvoices({});
    const nextInvNo = getNextInvoiceNo(invoices);
    $("invNo").value = nextInvNo;
    updatePreview();
    saveState();
  } catch (error) {
    console.error("Failed to fetch next invoice number:", error);
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    $("invNo").value = `INV-${ymd}-001`;
    updatePreview();
  }
}

function clearForm() {
  items = [];
  $("invNo").value = "";
  $("invDate").value = new Date().toISOString().slice(0, 10);
  $("billTo").value = "";
  $("taxPct").value = 0;
  renderInputs();
  updatePreview();
  saveState();
  fetchNextInvoiceNo();
}

function addItem(desc = "", qty = "", rate = "") {
  items.push({ desc, qty: qty === "" ? "" : Number(qty), rate: rate === "" ? "" : Number(rate) });
  renderInputs();
  updatePreview();
  saveState();
}

function removeItem(index) {
  items.splice(index, 1);
  renderInputs();
  updatePreview();
  saveState();
}

function renderInputs() {
  const container = $("itemsContainer");
  container.innerHTML = "";
  items.forEach((item, index) => {
    const row = document.createElement("div");
    row.className = "item-row";

    const desc = document.createElement("input");
    desc.type = "text";
    desc.placeholder = "Description";
    desc.value = item.desc;
    desc.addEventListener("input", e => { item.desc = e.target.value; updatePreview(); saveState(); });

    const qty = document.createElement("input");
    qty.type = "number";
    qty.className = "item-qty";
    qty.placeholder = "Qty";
    qty.min = "0";
    qty.step = "1";
    qty.value = item.qty;
    qty.addEventListener("input", e => { item.qty = e.target.value === "" ? "" : (Number(e.target.value) || 0); updatePreview(); saveState(); });

    const rate = document.createElement("input");
    rate.type = "number";
    rate.className = "item-rate";
    rate.placeholder = "Rate";
    rate.min = "0";
    rate.step = "0.01";
    rate.value = item.rate;
    rate.addEventListener("input", e => { item.rate = e.target.value === "" ? "" : (Number(e.target.value) || 0); updatePreview(); saveState(); });

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "X";
    remove.addEventListener("click", () => removeItem(index));

    row.appendChild(desc);
    row.appendChild(qty);
    row.appendChild(rate);
    row.appendChild(remove);
    container.appendChild(row);
  });

  if (items.length === 0) addItem("", "", "");
}

function formatDateDMY(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function updatePreview() {
  $("prevInvNo").innerText = $("invNo").value || "";
  $("prevDate").innerText = formatDateDMY($("invDate").value);
  $("prevBillTo").innerText = $("billTo").value || "";

  const tbody = $("previewTableBody");
  tbody.innerHTML = "";
  let subtotal = 0;

  items.forEach((item, index) => {
    // Skip completely blank rows in preview
    if (!item.desc && item.qty === "" && item.rate === "") {
      return;
    }
    const amount = Number(item.qty) * Number(item.rate) || 0;
    subtotal += amount;
    const tr = document.createElement("tr");

    const tdSl = document.createElement("td");
    tdSl.className = "text-center";
    tdSl.textContent = String(index + 1);

    const tdDesc = document.createElement("td");
    tdDesc.textContent = item.desc || "";

    const tdQty = document.createElement("td");
    tdQty.className = "text-center";
    tdQty.textContent = String(item.qty);

    const tdRate = document.createElement("td");
    tdRate.className = "text-right";
    tdRate.textContent = Number(item.rate).toFixed(2);

    const tdAmount = document.createElement("td");
    tdAmount.className = "text-right";
    tdAmount.textContent = Number(amount).toFixed(2);

    tr.appendChild(tdSl);
    tr.appendChild(tdDesc);
    tr.appendChild(tdQty);
    tr.appendChild(tdRate);
    tr.appendChild(tdAmount);
    tbody.appendChild(tr);
  });

  const taxPct = Number($("taxPct").value) || 0;
  const tax = subtotal * (taxPct / 100);
  const total = subtotal + tax;

  $("prevSubtotal").innerText = format(subtotal);
  $("prevTaxPct").innerText = taxPct.toFixed(2);
  $("prevTax").innerText = format(tax);
  $("prevTotal").innerText = format(total);
  $("formTotal").innerText = format(total);
}

function escapeHtml(value) {
  return (value || "").replace(/[&<>\"']/g, match => {
    switch (match) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#039;';
      default: return match;
    }
  });
}

function buildRecordFromForm() {
  const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.rate) || 0), 0);
  const taxPct = Number($("taxPct").value) || 0;
  const tax = subtotal * (taxPct / 100);
  return {
    invNo: $("invNo").value || null,
    date: $("invDate").value || new Date().toISOString().slice(0, 10),
    billTo: $("billTo").value,
    items,
    taxPct,
    subtotal,
    tax,
    total: subtotal + tax,
    createdAt: new Date().toISOString(),
  };
}

let currentAuthMode = "login";

function openAuthModal(mode = "login") {
  currentAuthMode = mode;
  $("authModal").style.display = "flex";
  
  $("modalEmail").value = "";
  $("modalPassword").value = "";
  checkPasswordStrength("");
  
  const regFields = $("registerFields");
  const strengthCont = $("strengthContainer");
  const forgotLink = $("forgotPasswordLink");
  const passGroup = $("passwordGroup");
  
  if (mode === "login") {
    $("modalTitle").innerText = "Welcome Back";
    $("modalSub").innerText = "Sign in to sync your invoices across all devices.";
    $("modalSubmitBtn").innerText = "Sign In";
    $("modalSwitchText").innerText = "Don't have an account?";
    $("modalSwitchLink").innerText = "Register";
    
    if (regFields) regFields.style.display = "none";
    if (strengthCont) strengthCont.style.display = "none";
    if (forgotLink) forgotLink.style.display = "inline";
    if (passGroup) passGroup.style.display = "block";
    
    $("regShopName").required = false;
    $("regAddress").required = false;
    $("regPhone").required = false;
  } else if (mode === "register") {
    $("modalTitle").innerText = "Create Account";
    $("modalSub").innerText = "Register to sync your invoices across all devices.";
    $("modalSubmitBtn").innerText = "Register";
    $("modalSwitchText").innerText = "Already have an account?";
    $("modalSwitchLink").innerText = "Sign In";
    
    if (regFields) regFields.style.display = "block";
    if (strengthCont) strengthCont.style.display = "flex";
    if (forgotLink) forgotLink.style.display = "none";
    if (passGroup) passGroup.style.display = "block";
    
    $("regShopName").required = true;
    $("regAddress").required = true;
    $("regPhone").required = true;
  } else if (mode === "forgot") {
    $("modalTitle").innerText = "Reset Password";
    $("modalSub").innerText = "Enter your email to receive a password reset link.";
    $("modalSubmitBtn").innerText = "Send Reset Link";
    $("modalSwitchText").innerText = "Remember your password?";
    $("modalSwitchLink").innerText = "Sign In";
    
    if (regFields) regFields.style.display = "none";
    if (strengthCont) strengthCont.style.display = "none";
    if (forgotLink) forgotLink.style.display = "none";
    if (passGroup) passGroup.style.display = "none";
    
    $("regShopName").required = false;
    $("regAddress").required = false;
    $("regPhone").required = false;
  }
}

function closeAuthModal() {
  $("authModal").style.display = "none";
}

function updateAuthUI() {
  const loggedIn = Boolean(firebaseAuthState && firebaseAuthState.localId);
  const headerStatus = $("authHeaderStatus");
  
  if (loggedIn) {
    closeAuthModal();
    
    headerStatus.innerHTML = "";
    const container = document.createElement("div");
    container.className = "header-user-status";
    
    const badge = document.createElement("span");
    badge.className = "user-email-badge";
    badge.textContent = firebaseAuthState.email || "User";
    
    const profileBtn = document.createElement("button");
    profileBtn.id = "profileBtn";
    profileBtn.className = "header-btn";
    profileBtn.textContent = "Shop Profile";
    profileBtn.addEventListener("click", () => openProfileModal());

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logoutBtn";
    logoutBtn.className = "header-logout-btn";
    logoutBtn.textContent = "Logout";
    
    container.appendChild(badge);
    container.appendChild(profileBtn);
    container.appendChild(logoutBtn);
    headerStatus.appendChild(container);
    
    logoutBtn.addEventListener("click", (event) => {
      event.preventDefault();
      logoutRest();
      showToast("Logged out successfully.", "info");
    });
    
    $("dbStatus").innerText = `Firebase connected as ${firebaseAuthState.localId}`;
    loadAndApplyUserProfile();
  } else {
    headerStatus.innerHTML = "";
    const loginBtn = document.createElement("button");
    loginBtn.id = "authTriggerBtn";
    loginBtn.className = "header-btn";
    loginBtn.textContent = "Sign In";
    headerStatus.appendChild(loginBtn);
    
    loginBtn.addEventListener("click", () => {
      openAuthModal("login");
    });
    
    $("dbStatus").innerText = "Please log in to sync invoices.";
    updateShopProfileUI(null);
  }
}

async function refreshFirebaseStatus() {
  try {
    const api = await ensureFirebaseApi();
    if (!api || !api.getFirebaseStatus) {
      $("dbStatus").innerText = "Firebase API unavailable in this build.";
      return;
    }
    const status = await api.getFirebaseStatus();
    if (status.connected) {
      updateAuthUI();
      loadAndApplyUserProfile();
    } else {
      $("dbStatus").innerText = "Please log in to sync invoices.";
    }
  } catch (error) {
    $("dbStatus").innerText = "Firebase connection failed.";
    return;
  }
}

async function saveInvoiceToDB() {
  let api;
  try {
    api = await ensureFirebaseApi();
  } catch (error) {
    showToast(error.message || "Firebase API is not available.", "error");
    return null;
  }

  try {
    const saved = await api.saveInvoice(buildRecordFromForm());
    if (saved && saved.id) {
      $("invNo").value = saved.invNo || $("invNo").value;
      updatePreview();
      saveState();
      showToast("Saved invoice successfully!", "success");
      return saved;
    }
    return null;
  } catch (error) {
    showToast("Save failed: " + error.message, "error");
    return null;
  }
}

async function queryInvoices(filter = {}) {
  try {
    const api = await ensureFirebaseApi();
    return await api.listInvoices(filter || {});
  } catch (error) {
    console.error("Failed to query invoices:", error);
    showToast("Failed to load invoices: " + error.message, "error");
    return [];
  }
}

async function renderBrowser(filter = {}) {
  const rows = await queryInvoices(filter);
  const body = $("browserBody");
  body.innerHTML = "";
  rows.sort((a, b) => (a.date || "") < (b.date || "") ? 1 : -1);
  rows.forEach((row) => {
    const tr = document.createElement("tr");

    const tdId = document.createElement("td");
    tdId.textContent = row.id || "";

    const tdInvNo = document.createElement("td");
    tdInvNo.textContent = row.invNo || "";

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDateDMY(row.date);

    const tdClient = document.createElement("td");
    tdClient.textContent = (row.billTo || "").split('\n')[0];

    const tdTotal = document.createElement("td");
    tdTotal.className = "text-right";
    tdTotal.textContent = format(row.total || 0);

    const tdAction = document.createElement("td");
    const openBtn = document.createElement("button");
    openBtn.className = "openInvoiceBtn";
    openBtn.textContent = "Open";
    openBtn.addEventListener("click", () => loadInvoiceToForm(row.id));
    tdAction.appendChild(openBtn);

    tr.appendChild(tdId);
    tr.appendChild(tdInvNo);
    tr.appendChild(tdDate);
    tr.appendChild(tdClient);
    tr.appendChild(tdTotal);
    tr.appendChild(tdAction);

    body.appendChild(tr);
  });
}

async function loadInvoiceToForm(id) {
  try {
    const api = await ensureFirebaseApi();
    const row = await api.getInvoice(id);
    if (!row) {
      showToast("Invoice not found.", "error");
      return;
    }
    $("invNo").value = row.invNo || "";
    $("invDate").value = row.date || new Date().toISOString().slice(0, 10);
    $("billTo").value = row.billTo || "";
    items = row.items || [];
    $("taxPct").value = row.taxPct || 0;
    renderInputs();
    updatePreview();
    $("browserPanel").style.display = "none";
    showToast("Loaded invoice successfully.", "success");
  } catch (error) {
    showToast("Load failed: " + error.message, "error");
  }
}

async function exportCSV() {
  const rows = await queryInvoices({});
  if (!rows.length) {
    showToast("No invoices to export.", "info");
    return;
  }
  const cols = ["id", "invNo", "date", "billTo", "subtotal", "taxPct", "tax", "total", "createdAt"];
  const lines = [cols.join(",")];
  rows.forEach((row) => {
    const vals = cols.map((col) => {
      let val = "";
      if (col === "id") val = row.id;
      else if (col === "invNo") val = row.invNo;
      else if (col === "date") val = row.date;
      else if (col === "billTo") val = row.billTo;
      else if (col === "subtotal") val = row.subtotal;
      else if (col === "taxPct") val = row.taxPct;
      else if (col === "tax") val = row.tax;
      else if (col === "total") val = row.total;
      else if (col === "createdAt") val = row.createdAt;
      return '"' + String(val || "").replace(/"/g, '""') + '"';
    });
    lines.push(vals.join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "invoices.csv";
  a.click();
  URL.revokeObjectURL(url);
  showToast("CSV Exported successfully.", "success");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!window.api) {
    await loadConfig();
  }
  restoreSession();
  updateAuthUI();
  clearForm();
  $("addItemBtn").addEventListener("click", (event) => { event.preventDefault(); addItem(); });
  $("printBtn").addEventListener("click", () => window.print());
  $("invNo").addEventListener("input", () => { saveState(); updatePreview(); });
  $("invDate").addEventListener("change", () => { saveState(); updatePreview(); });
  $("billTo").addEventListener("input", () => { saveState(); updatePreview(); });
  $("taxPct").addEventListener("input", () => { saveState(); updatePreview(); });
  renderInputs();
  updatePreview();
  refreshFirebaseStatus();
  
  // Modals close triggers
  $("openBtn").addEventListener("click", () => { $("browserPanel").style.display = "flex"; renderBrowser({}); });
  $("closeBrowser").addEventListener("click", () => { $("browserPanel").style.display = "none"; });
  $("closeAuthModalBtn").addEventListener("click", () => { closeAuthModal(); });
  $("closeProfileModalBtn").addEventListener("click", () => { closeProfileModal(); });
  
  $("filterBtn").addEventListener("click", () => renderBrowser({ from: $("filterFrom").value || null, to: $("filterTo").value || null, invNo: $("filterInvNo").value || null }));
  $("newBtn").addEventListener("click", (event) => { event.preventDefault(); clearForm(); });
  $("saveBtn").addEventListener("click", () => saveInvoiceToDB());
  $("exportBtn").addEventListener("click", () => exportCSV());

  // Forgot Password link trigger
  $("forgotPasswordLink").addEventListener("click", (event) => {
    event.preventDefault();
    openAuthModal("forgot");
  });

  // Password input dynamic strength checker
  $("modalPassword").addEventListener("input", (e) => {
    if (currentAuthMode === "register") {
      checkPasswordStrength(e.target.value);
    }
  });

  // Shop Profile Form submission trigger
  $("profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const shopName = $("profShopName").value.trim();
    const address = $("profAddress").value.trim();
    const phone = $("profPhone").value.trim();
    const email = $("profEmail").value.trim();
    const gstNo = $("profGst").value.trim();
    
    let logoBase64 = null;
    const logoFile = $("profLogo").files[0];
    if (logoFile) {
      logoBase64 = await readImageAsBase64($("profLogo"));
    } else {
      const previewImg = $("profLogoPreview");
      if (previewImg.src && !previewImg.src.endsWith("#") && !previewImg.src.startsWith(window.location.origin)) {
        logoBase64 = previewImg.src;
      }
    }
    
    const profileData = {
      shopName,
      address,
      phone,
      email,
      gstNo,
      logoBase64
    };
    
    try {
      showToast("Saving shop profile...", "info");
      await saveShopProfile(profileData);
      showToast("Shop profile saved successfully!", "success");
      updateShopProfileUI(profileData);
      closeProfileModal();
    } catch (e) {
      showToast("Failed to save profile: " + e.message, "error");
    }
  });

  // Shop Profile Logo file upload preview trigger
  $("profLogo").addEventListener("change", async () => {
    const file = $("profLogo").files[0];
    if (file) {
      const base64 = await readImageAsBase64($("profLogo"));
      const previewImg = $("profLogoPreview");
      if (previewImg) {
        previewImg.src = base64;
        previewImg.style.display = "block";
      }
    }
  });

  // Modal switch link trigger (Login <-> Register <-> Forgot)
  $("modalSwitchLink").addEventListener("click", (event) => {
    event.preventDefault();
    if (currentAuthMode === "login") {
      openAuthModal("register");
    } else {
      openAuthModal("login");
    }
  });

  // Auth form submission trigger
  $("authModalForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = $("modalEmail").value.trim();
    const password = $("modalPassword").value;
    
    if (currentAuthMode === "forgot") {
      if (!email) {
        showToast("Please enter your email.", "error");
        return;
      }
      try {
        $("dbStatus").innerText = "Sending reset email...";
        await sendPasswordReset(email);
        showToast("Password reset email sent! Check your inbox.", "success");
        openAuthModal("login");
      } catch (e) {
        showToast(e.message, "error");
      }
      return;
    }
    
    if (!email || !password) {
      showToast("Please enter email and password.", "error");
      return;
    }
    
    if (currentAuthMode === "register") {
      const strength = checkPasswordStrength(password);
      if (strength === "weak" || password.length < 8) {
        showToast("Password is too weak. Please choose a stronger password.", "error");
        return;
      }
    }

    try {
      if (currentAuthMode === "login") {
        $("dbStatus").innerText = "Logging in...";
        await loginRest(email, password);
        showToast("Logged in successfully!", "success");
      } else {
        $("dbStatus").innerText = "Registering...";
        await registerRest(email, password);
        
        // Save initial shop profile during registration
        const shopName = $("regShopName").value.trim();
        const address = $("regAddress").value.trim();
        const phone = $("regPhone").value.trim();
        const gstNo = $("regGst").value.trim();
        
        let logoBase64 = null;
        if ($("regLogo").files[0]) {
          logoBase64 = await readImageAsBase64($("regLogo"));
        }
        
        const profileData = {
          shopName,
          address,
          phone,
          email,
          gstNo,
          logoBase64
        };
        
        try {
          await saveShopProfile(profileData);
          showToast("Profile set up successfully!", "success");
        } catch (profileErr) {
          console.error("Failed to save initial profile:", profileErr);
          showToast("Registered successfully, but profile setup failed. You can customize details later.", "info");
        }
        
        showToast("Registered successfully!", "success");
      }
      fetchNextInvoiceNo();
    } catch (e) {
      showToast(e.message, "error");
      refreshFirebaseStatus();
    }
  });
});
