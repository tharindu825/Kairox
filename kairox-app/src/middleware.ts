import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isRoot = nextUrl.pathname === '/';
  const isAuthPage = nextUrl.pathname === '/login';
  const isDashboard = nextUrl.pathname.startsWith('/dashboard');
  const isApiAuth = nextUrl.pathname.startsWith('/api/auth');
  const isApiRoute = nextUrl.pathname.startsWith('/api');

  // Helper to construct absolute redirect URLs using X-Forwarded headers if present
  const getRedirectUrl = (path: string) => {
    const forwardedHost = req.headers.get('x-forwarded-host');
    const forwardedProto = req.headers.get('x-forwarded-proto') || (nextUrl.protocol.startsWith('https') ? 'https' : 'http');
    if (forwardedHost) {
      return `${forwardedProto}://${forwardedHost}${path}`;
    }
    return new URL(path, nextUrl);
  };

  // Allow auth API routes to pass through
  if (isApiAuth) {
    return NextResponse.next();
  }

  // Handle root route redirection directly in middleware to prevent Next.js default redirect to localhost
  if (isRoot) {
    const target = isLoggedIn ? '/dashboard' : '/login';
    return NextResponse.redirect(getRedirectUrl(target));
  }

  // Redirect logged-in users away from login page
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(getRedirectUrl('/dashboard'));
  }

  // Protect dashboard routes
  if (isDashboard && !isLoggedIn) {
    return NextResponse.redirect(getRedirectUrl('/login'));
  }

  // Protect API routes (except auth)
  if (isApiRoute && !isApiAuth && !isLoggedIn) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
