import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';
import bcrypt from 'bcryptjs';

async function addUser() {
  const db = await getDb();
  
  const email = 'tharindudilshan0825@gmail.com';
  const password = 'Ddunac@41';
  const passwordHash = await bcrypt.hash(password, 12);

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

  // Verify it worked
  const user = await db.collection('users').findOne({ email });
  const isValid = await bcrypt.compare(password, user!.passwordHash);
  
  console.log(`✅ User created: ${email}`);
  console.log(`✅ Password verification: ${isValid}`);
  
  process.exit(0);
}

addUser().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
