import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string().min(6),
  name: z.string().min(1).optional(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password, name } = registerSchema.parse(body);

    const db = await getDb();
    const usersColl = db.collection('users');
    
    const existingUser = await usersColl.findOne({ email });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email already registered' },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // First user gets ADMIN role
    const userCount = await usersColl.countDocuments();
    const role = userCount === 0 ? 'ADMIN' : 'VIEWER';

    const newUser = {
      email,
      passwordHash,
      name: name || email.split('@')[0],
      role,
      createdAt: new Date(),
    };

    const result = await usersColl.insertOne(newUser);
    const newUserId = result.insertedId.toString();

    // Audit log
    await db.collection('auditLogs').insertOne({
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
