import 'dotenv/config';
import { db } from '../src/lib/firebase-admin';

async function checkUsers() {
  console.log('Checking users collection...');
  const snapshot = await db.collection('users').get();
  
  if (snapshot.empty) {
    console.log('No users found.');
    return;
  }

  snapshot.forEach(doc => {
    const data = doc.data();
    console.log(`User: ${data.email}, Name: ${data.name}, Role: ${data.role}`);
  });
}

checkUsers().catch(console.error);
