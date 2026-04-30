import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';
import bcrypt from 'bcryptjs';

async function addUser() {
  const email = 'tharindudilshan0825@gmail.com';
  const password = 'Ddunac@41';
  
  console.log(`🚀 Adding user: ${email}...`);
  const db = await getDb();
  const passwordHash = await bcrypt.hash(password, 10);

  await db.collection('users').updateOne(
    { email },
    {
      $set: {
        email,
        name: 'Tharindu',
        passwordHash,
        role: 'ADMIN',
        createdAt: new Date(),
      }
    },
    { upsert: true }
  );

  console.log('✅ User created/updated successfully! You can now log in.');
  process.exit(0);
}

addUser().catch(err => {
  console.error('❌ Failed to add user:', err);
  process.exit(1);
});
