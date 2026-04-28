import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/firebase-admin';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name } = registerSchema.parse(body);

    const usersRef = db.collection('users');
    const existingSnapshot = await usersRef.where('email', '==', email).limit(1).get();

    if (!existingSnapshot.empty) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // First user gets ADMIN role
    const allUsersSnapshot = await usersRef.count().get();
    const userCount = allUsersSnapshot.data().count;
    const role = userCount === 0 ? 'ADMIN' : 'VIEWER';

    const newUserRef = usersRef.doc();
    const newUserId = newUserRef.id;

    await newUserRef.set({
      email,
      passwordHash,
      name: name || email.split('@')[0],
      role,
      createdAt: new Date(),
    });

    // Audit log
    await db.collection('auditLogs').add({
      userId: newUserId,
      action: 'REGISTER',
      entity: 'User',
      entityId: newUserId,
      details: { role },
      createdAt: new Date(),
    });

    return NextResponse.json(
      { message: 'Account created successfully', role },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message || 'Invalid input' },
        { status: 400 }
      );
    }
    console.error('Registration error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
