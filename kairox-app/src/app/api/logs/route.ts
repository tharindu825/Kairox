import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = await getDb();
    const logs = await db.collection('systemLogs')
      .find({})
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    const formattedLogs = logs.map(log => ({
      ...log,
      id: log._id.toString(),
    }));

    return NextResponse.json(formattedLogs);
  } catch (error) {
    console.error('[API] Failed to fetch system logs:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
