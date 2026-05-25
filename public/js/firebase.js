import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  query,
  where,
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
  deleteField,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  query,
  where,
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
  deleteField,
};

export const firebaseConfig = {
  apiKey: "AIzaSyCQaHON0-4rpJLZfO7ufqN6vQeO9qlTm5o",
  authDomain: "project-ffc49bd5-9852-4aa9-b6b.firebaseapp.com",
  projectId: "project-ffc49bd5-9852-4aa9-b6b",
  storageBucket: "project-ffc49bd5-9852-4aa9-b6b.firebasestorage.app",
  messagingSenderId: "281617058598",
  appId: "1:281617058598:web:ead2b7cd9048abbf4e0fe7",
  measurementId: "G-TC7J2GZTGF",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
