// Template for firebaseConfig.js — do not import this file directly.
// scripts/build-config.js reads .env and writes the real firebaseConfig.js
// next to this file (gitignored, since it's a generated build artifact).
// Run `node scripts/build-config.js` after changing .env, and it also runs
// automatically before `firebase deploy` via firebase.json's predeploy hook.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getDatabase } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-database.js';

const firebaseConfig = {
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  databaseURL: '__FIREBASE_DATABASE_URL__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);
