import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAXepynvSMdImIGA-Eip6jUFrPipsbVws8",
  authDomain: "jspmprint.firebaseapp.com",
  projectId: "jspmprint",
  storageBucket: "jspmprint.firebasestorage.app",
  messagingSenderId: "988562022000",
  appId: "1:988562022000:web:6e7332b7298b60bbf95eb5",
  measurementId: "G-678LK4DNN0"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { app, db };
