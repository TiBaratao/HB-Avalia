import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  sendPasswordResetEmail,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./client";

export function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
}

export async function createInvitedAccount(email: string, password: string, name: string) {
  const credentials = await createUserWithEmailAndPassword(getFirebaseAuth(), email.trim().toLowerCase(), password);
  await updateProfile(credentials.user, { displayName: name.trim() });
  await sendEmailVerification(credentials.user);
  return credentials;
}

export async function resendVerificationEmail(user: User) {
  await sendEmailVerification(user);
}

export async function refreshEmailVerification(user: User) {
  await reload(user);
  await user.getIdToken(true);
  return user.emailVerified;
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
