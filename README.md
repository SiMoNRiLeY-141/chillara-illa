# Chillara Illa

Chillara Illa is a desktop-first invoicing application built with Electron, Express, SQLite, and Firebase. Invoices and drafts are saved locally first, then queued for Firebase synchronization after sign-in or reconnection.

## Prerequisites

- Node.js 18 or later
- A Firebase project with Email/Password Authentication and Cloud Firestore enabled
- For Windows packaging: Visual Studio 2022 Build Tools with the **Desktop development with C++** workload

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `firebase-config.json` in the repository root by copying `firebase-config.template.json`.

3. Fill it with the Firebase web app configuration from **Project settings** in the Firebase console. This local file is intentionally ignored by Git.

4. In Firebase Authentication, enable the **Email/Password** provider. Create a Cloud Firestore database and deploy the checked-in `firestore.rules` file. These rules scope every application record to its authenticated user's UID.

   ```javascript
   npx -y firebase-tools@latest deploy --only firestore:rules --project YOUR_PROJECT_ID
   ```

## Run

Run the Electron application:

```bash
npm start
```

The Electron main process starts the bundled Express service on a random loopback port. Its API is protected by a per-launch secret exposed only through the preload bridge; it is not intended to be exposed as a network service.

## Packaging

Create unpacked Electron output:

```bash
npm run pack
```

Create distributable installers:

```bash
npm run dist
```

Generated output is written outside version control.

`npm run pack` rebuilds SQLite for the pinned Electron runtime before packaging. Run `npm test` before packaging; the native binding is then rebuilt for Electron and is no longer runnable under the system Node process.

## Repository hygiene

`firebase-config.json` is a **public web configuration** file. It may contain the Firebase Web API key, which is not a server secret and is necessarily available to the client. It must contain only the fields in `firebase-config.template.json`; the application filters any extra fields before exposing the configuration.

Protect the Web API key in Google Cloud Console by restricting it to this Firebase project’s required APIs and to the app's approved web origins. Never place service-account JSON, private keys, admin SDK credentials, or third-party secrets in `firebase-config.json`, the renderer, or any committed file. Store those only in the deployment platform's secret manager or environment configuration.

The Express service binds only to `127.0.0.1`, uses an ephemeral port, and requires the Electron-provided secret for all invoice APIs. Do not expose it on a public interface.

Do not commit `firebase-config.json`, `.env` files, service-account credentials, local invoice databases, dependency folders, build outputs, logs, or generated Firebase tooling files. The root `.gitignore` covers these artifacts.
