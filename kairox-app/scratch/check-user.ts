import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';
import bcrypt from 'bcryptjs';

async function checkUser() {
  const db = await getDb();
  
  // List ALL users in the database
  const allUsers = await db.collection('users').find({}).toArray();
  console.log(`\n📋 Total users in DB: ${allUsers.length}`);
  
  for (const u of allUsers) {
    console.log(`\n--- User ---`);
    console.log(`  _id: ${u._id}`);
    console.log(`  email: ${u.email}`);
    console.log(`  name: ${u.name}`);
    console.log(`  role: ${u.role}`);
    console.log(`  has passwordHash: ${!!u.passwordHash}`);
    console.log(`  passwordHash value: ${u.passwordHash ? u.passwordHash.substring(0, 20) + '...' : 'MISSING'}`);
    console.log(`  all keys: ${Object.keys(u).join(', ')}`);
  }

  // Specifically check the user trying to login
  const targetEmail = 'tharindudilshan0825@gmail.com';
  const targetPassword = 'Ddunac@41';
  
  console.log(`\n🔍 Looking for: ${targetEmail}`);
  const user = await db.collection('users').findOne({ email: targetEmail });
  
  if (!user) {
    console.log('❌ User NOT FOUND in database!');
    console.log('   This user needs to register first.');
  } else {
    console.log('✅ User found!');
    console.log(`   Fields: ${Object.keys(user).join(', ')}`);
    
    if (user.passwordHash) {
      console.log(`   passwordHash exists: ${user.passwordHash.substring(0, 20)}...`);
      
      // Test password comparison
      const isValid = await bcrypt.compare(targetPassword, user.passwordHash);
      console.log(`   Password "${targetPassword}" matches: ${isValid}`);
    } else {
      console.log('   ❌ NO passwordHash field on this user document!');
    }
  }

  process.exit(0);
}

checkUser().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
