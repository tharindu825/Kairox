import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const uri = process.env.MONGODB_URI;
const user = process.env.MONGODB_USER;
const pass = process.env.MONGODB_PASS;

let authUri = uri;
if (user && pass && uri?.includes('mongodb+srv://') && !uri.includes('@')) {
  authUri = uri.replace('mongodb+srv://', `mongodb+srv://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@`);
}

async function listCollections() {
  const client = new MongoClient(authUri!);
  try {
    await client.connect();
    const db = client.db('kairox');
    const collections = await db.listCollections().toArray();
    console.log(collections.map(c => c.name));
  } finally {
    await client.close();
  }
}
listCollections().catch(console.error);
