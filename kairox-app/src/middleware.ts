import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import { NextResponse } from 'next/server';

const { auth } = NextAuth(authConfig);

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;

  const isAuthPage = nextUrl.pathname === '/login';
  const isDashboard = nextUrl.pathname.startsWith('/dashboard');
  const isApiAuth = nextUrl.pathname.startsWith('/api/auth');
  const isApiRoute = nextUrl.pathname.startsWith('/api');

  // Allow auth API routes to pass through
  if (isApiAuth) {
    return NextResponse.next();
  }

  // Redirect logged-in users away from login page
  if (isAuthPage && isLoggedIn) {
    return NextResponse.redirect(new URL('/dashboard', nextUrl));
  }

  // Protect dashboard routes
  if (isDashboard && !isLoggedIn) {
    return NextResponse.redirect(new URL('/login', nextUrl));
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
