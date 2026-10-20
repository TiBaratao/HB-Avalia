import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./client";

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
}

export async function signUp(email: string, password: string, name: string) {
  const credentials = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim().toLowerCase(), password);
  await updateProfile(credentials.user, { displayName: name.trim() });
  return credentials;
}

export function resetPassword(email: string) {
  return sendPasswordResetEmail(getFirebaseAuth(), email.trim().toLowerCase());
}

export function signOutCurrentUser() {
  return signOut(getFirebaseAuth());
}

export function watchAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(getFirebaseAuth(), callback);
}
