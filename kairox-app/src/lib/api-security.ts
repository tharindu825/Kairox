import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { checkRateLimit, rateLimitHeaders, type RateLimitConfig } from '@/lib/rate-limit';
import { headers } from 'next/headers';

/**
 * Wraps an API route handler with authentication and rate limiting.
 * Returns the session if checks pass, or a NextResponse error otherwise.
 */
export async function protectRoute(
  rateLimitConfig?: RateLimitConfig
): Promise<{ session: any } | NextResponse> {
  // 1. Auth check
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Rate limit check
  if (rateLimitConfig) {
    const headerStore = await headers();
    const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() || 
               headerStore.get('x-real-ip') || 
               'unknown';
    const identifier = `${session.user.id || session.user.email || ip}`;
    const result = checkRateLimit(identifier, rateLimitConfig);

    if (!result.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: rateLimitHeaders(result) }
      );
    }
  }

  return { session };
}

/**
 * Sanitize a string input to prevent injection.
 */
export function sanitizeInput(input: string, maxLength = 500): string {
  return input
    .trim()
    .slice(0, maxLength)
    .replace(/[<>]/g, ''); // Strip basic HTML tags
}
