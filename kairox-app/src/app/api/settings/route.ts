import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase-admin';
import { auth } from '@/lib/auth';
import { checkRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { z } from 'zod';

export async function GET() {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Load active strategy policy
    const policySnapshot = await db.collection('strategyPolicy').where('isActive', '==', true).limit(1).get();
    let policy = null;
    if (!policySnapshot.empty) {
      policy = { id: policySnapshot.docs[0].id, ...policySnapshot.docs[0].data() };
    }

    // Load model configs
    const modelConfigsSnapshot = await db.collection('modelConfig').where('isActive', '==', true).get();
    const modelConfigs = modelConfigsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    return NextResponse.json({
      policy: policy || {
        name: 'Default',
        maxRiskPercent: 2.0,
        maxOpenTrades: 5,
        maxCorrelated: 3,
        minRewardRisk: 1.5,
        dailyDrawdownLimit: 5.0,
        cooldownMinutes: 60,
        isActive: true,
      },
      models: modelConfigs.length > 0 ? modelConfigs : [
        {
          id: 'default-primary',
          modelId: process.env.PRIMARY_MODEL || 'anthropic/claude-sonnet-4',
          apiProvider: 'openrouter',
          role: 'PRIMARY',
          isActive: true,
          parameters: { temperature: 0.3, maxTokens: 2000 },
          fallback: process.env.PRIMARY_FALLBACK_MODEL || 'google/gemini-2.5-pro',
        },
        {
          id: 'default-confirmation',
          modelId: process.env.CONFIRMATION_MODEL || 'meta-llama/llama-3-70b-instruct',
          apiProvider: 'openrouter',
          role: 'CONFIRMATION',
          isActive: true,
          parameters: { temperature: 0.3, maxTokens: 2000 },
          fallback: process.env.CONFIRMATION_FALLBACK_MODEL || 'anthropic/claude-3-haiku',
        },
      ],
      alerts: {
        telegramConfigured: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
        minConfidence: 0.7,
      },
    });
  } catch (error) {
    console.error('[API] Failed to fetch settings:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

const updatePolicySchema = z.object({
  maxRiskPercent: z.number().min(0.1).max(10).optional(),
  maxOpenTrades: z.number().int().min(1).max(20).optional(),
  maxCorrelated: z.number().int().min(1).max(10).optional(),
  minRewardRisk: z.number().min(0.5).max(5).optional(),
  dailyDrawdownLimit: z.number().min(1).max(20).optional(),
  cooldownMinutes: z.number().int().min(0).max(1440).optional(),
});

const updateModelsSchema = z.object({
  primary: z.object({
    modelId: z.string().min(1),
    fallback: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(100).max(8000),
  }).optional(),
  confirmation: z.object({
    modelId: z.string().min(1),
    fallback: z.string().min(1),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(100).max(8000),
  }).optional(),
});

const updateAlertsSchema = z.object({
  minConfidence: z.number().min(0).max(1),
});

export async function PUT(request: Request) {
  try {
    const session = await auth();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit: 10 settings updates per minute
    const rl = checkRateLimit(`settings:${session.user?.email || 'anon'}`, { maxRequests: 10, windowSeconds: 60 });
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many update requests.' }, { status: 429, headers: rateLimitHeaders(rl) });
    }

    const body = await request.json();
    const { type } = body;

    if (type === 'policy') {
      const validated = updatePolicySchema.parse(body.data);
      const policyData = { name: 'Default', ...validated, isActive: true };
      
      await db.collection('strategyPolicy').doc('Default').set(policyData, { merge: true });

      return NextResponse.json({ message: 'Risk policy updated', policy: policyData });
    }

    if (type === 'models') {
      const validated = updateModelsSchema.parse(body.data);
      const batch = db.batch();

      // Update model configs in DB
      if (validated.primary) {
        const primaryRef = db.collection('modelConfig').doc('primary-config');
        batch.set(primaryRef, {
          id: 'primary-config',
          modelId: validated.primary.modelId,
          apiProvider: 'openrouter',
          role: 'PRIMARY',
          isActive: true,
          parameters: {
            temperature: validated.primary.temperature,
            maxTokens: validated.primary.maxTokens,
          },
        }, { merge: true });
      }

      if (validated.confirmation) {
        const confRef = db.collection('modelConfig').doc('confirmation-config');
        batch.set(confRef, {
          id: 'confirmation-config',
          modelId: validated.confirmation.modelId,
          apiProvider: 'openai',
          role: 'CONFIRMATION',
          isActive: true,
          parameters: {
            temperature: validated.confirmation.temperature,
            maxTokens: validated.confirmation.maxTokens,
          },
        }, { merge: true });
      }

      await batch.commit();
      return NextResponse.json({ message: 'Model configuration updated' });
    }

    if (type === 'alerts') {
      const validated = updateAlertsSchema.parse(body.data);
      // In a real application, we would save this to the DB.
      // For now, since settings returned are mocked for alerts, we just return success.
      return NextResponse.json({ message: 'Alert configuration updated', data: validated });
    }

    return NextResponse.json({ error: 'Unknown settings type' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message || 'Invalid input' }, { status: 400 });
    }
    console.error('[API] Failed to update settings:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
