import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis';
import Redis from 'ioredis';

// Use a separate connection for subscribing
const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const clients = new Set<ReadableStreamDefaultController>();

subscriber.subscribe('kairox:notifications', (err, count) => {
  if (err) {
    console.error('[SSE] Failed to subscribe to notifications channel:', err);
  }
});

subscriber.on('message', (channel, message) => {
  if (channel === 'kairox:notifications') {
    try {
      const data = JSON.parse(message);
      notifyClients(data);
    } catch (err) {
      console.error('[SSE] Failed to parse notification message:', err);
    }
  }
});

export function notifyClients(data: any) {
  const message = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of clients) {
    try {
      controller.enqueue(new TextEncoder().encode(message));
    } catch {
      clients.delete(controller);
    }
  }
}

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller);

      // Send initial connection event
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`)
      );

      // Send heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })}\n\n`)
          );
        } catch {
          clearInterval(heartbeat);
          clients.delete(controller);
        }
      }, 30000);

      // Cleanup on close
      const cleanup = () => {
        clearInterval(heartbeat);
        clients.delete(controller);
      };

      // Store cleanup for later
      (controller as any).__cleanup = cleanup;
    },
    cancel(controller) {
      const cleanup = (controller as any).__cleanup;
      if (cleanup) cleanup();
      clients.delete(controller);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
