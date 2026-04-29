import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_PROJECT_ID) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // Replace escaped newlines with actual newlines
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        }),
      });
      console.log('[Firebase] Admin SDK initialized.');
    } else {
      console.warn('[Firebase] FIREBASE_PROJECT_ID is missing. Skipping Admin SDK initialization (useful for builds).');
    }
  } catch (error) {
    console.error('[Firebase] Failed to initialize Admin SDK:', error);
  }
}

// Export the db instance, casting to any if uninitialized to prevent build crashes
export const db = admin.apps.length > 0 ? admin.firestore() : {} as FirebaseFirestore.Firestore;
