import 'dotenv/config';
import { getDb } from '../src/lib/mongodb';
import bcrypt from 'bcryptjs';

async function seed() {
  console.log('🌱 Seeding Local MongoDB...');
  const db = await getDb();

  // 1. Create Admin User
  const email = 'admin@kairox.ai';
  const password = 'admin-password-123';
  const passwordHash = await bcrypt.hash(password, 10);

  await db.collection('users').updateOne(
    { email },
    {
      $set: {
        email,
        name: 'Kairox Admin',
        passwordHash,
        role: 'ADMIN',
        createdAt: new Date(),
      }
    },
    { upsert: true }
  );

  console.log(`✅ Admin user created: ${email} / ${password}`);

  // 2. Initialize Assets (Top 10)
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'ADAUSDT', 'XRPUSDT', 'DOTUSDT', 'DOGEUSDT', 'MATICUSDT', 'LINKUSDT'];
  
  for (const symbol of symbols) {
    await db.collection('assets').updateOne(
      { symbol },
      {
        $setOnInsert: {
          symbol,
          name: symbol.replace('USDT', ''),
          category: 'CRYPTO',
          signalsCount: 0,
          createdAt: new Date(),
        }
      },
      { upsert: true }
    );
  }

  console.log('✅ Top 10 assets initialized.');
  console.log('🚀 MongoDB seeding complete! You can now login.');
  process.exit(0);
}

seed().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
