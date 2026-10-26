import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

export function getAdminAuth(): Auth;
export function getAdminFirestore(): Firestore;
