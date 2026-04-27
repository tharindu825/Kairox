import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Auth
  AUTH_SECRET: z.string().min(16),
  NEXTAUTH_URL: z.string().url().optional(),

  // AI APIs
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default('https://openrouter.ai/api/v1'),
  OPENAI_API_KEY: z.string().min(1),

  // Models
  PRIMARY_MODEL: z.string().default('anthropic/claude-sonnet-4'),
  PRIMARY_FALLBACK_MODEL: z.string().default('google/gemini-2.5-pro'),
  CONFIRMATION_MODEL: z.string().default('gpt-4o'),
  CONFIRMATION_FALLBACK_MODEL: z.string().default('gpt-4o-mini'),

  // Binance
  BINANCE_WS_URL: z.string().default('wss://stream.binance.com:9443'),
  BINANCE_REST_URL: z.string().default('https://api.binance.com'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // App
  NEXT_PUBLIC_APP_NAME: z.string().default('Kairox'),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

function getEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }

  return parsed.data;
}

export const env = getEnv();
