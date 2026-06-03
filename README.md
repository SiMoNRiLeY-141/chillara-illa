# Chillara Illa - Premium Commercial Invoicing SaaS App

This is a premium, lightweight commercial invoicing application backed by Firebase and styled using modern, high-end CSS aesthetics.

## Configuration & Prerequisites

Since this application is intended to run as a secure, private SaaS app with Firebase integration, **you must configure your Firebase project details before running or registering.**

### Firebase Setup Steps:

1. **Create a Firebase Project**:
   - Go to the [Firebase Console](https://console.firebase.google.com/).
   - Click **Add project** and name it (e.g., `chillara-illa`).

2. **Enable Authentication & Firestore Database**:
   - In the Firebase Console left menu, navigate to **Build** > **Authentication**, click **Get Started**, and enable the **Email/Password** sign-in provider.
   - Navigate to **Build** > **Firestore Database**, click **Create database**, select a location, and choose to start in **Production mode** or **Test mode**.
   
3. **Register a Web App & Get Config**:
   - In the Firebase Console Project Overview page, click the **Web icon (`</>`)** to register a web app.
   - Copy the `firebaseConfig` object from the setup script. It looks like:
     ```json
     {
       "apiKey": "YOUR_API_KEY",
       "authDomain": "YOUR_PROJECT_ID.firebaseapp.com",
       "projectId": "YOUR_PROJECT_ID",
       "storageBucket": "YOUR_PROJECT_ID.firebasestorage.app",
       "messagingSenderId": "YOUR_SENDER_ID",
       "appId": "YOUR_APP_ID"
     }
     ```

4. **Create the Local Config File**:
   - Create a file named `firebase-config.json` in the root of this project (which is excluded from Git to prevent key exposure).
   - Paste the config JSON object you copied in Step 3. (See `firebase-config.template.json` for structure).

5. **Firestore Security Rules**:
   - Set the security rules in **Firestore Database** > **Rules** to allow users to read/write their own records:
     ```javascript
     rules_version = '2';
     service cloud.firestore {
       match /databases/{database}/documents {
         match /users/{userId}/{document=**} {
           allow read, write: if request.auth != null && request.auth.uid == userId;
         }
       }
     }
     ```

---

## Running the Application

### 1. Install Dependencies:
```bash
npm install
```

### 2. Start the Application:
- Run the Electron client app (recommended for native SDK features):
  ```bash
  npm start
  ```
- Alternatively, run the Express server for web access:
  ```bash
  npm run server
  ```
  And open http://localhost:3000 in your browser.

---

## Technical Features

- **Shop Settings & Custom Logos**: Upload custom business logos (stored as Base64 strings in Firestore settings) and define business details dynamically.
- **Conditional Receipt Header Rendering**: Auto-hides GSTIN line if no GST number is configured.
- **Visual Password Strength Indicator**: Analyzes complex password combinations and requires a secure password on registration.
- **Password Reset Flow**: Standard forgot password recovery emails via Firebase Auth.
- **Database Backup**: Syncs invoices to Firestore while supporting local CSV exports.
