import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { getDb } from '@/lib/mongodb';
import { authConfig } from './auth.config';

/**
 * NextAuth v5 configuration.
 *
 * IMPORTANT: We do NOT use MongoDBAdapter here because the Credentials provider
 * with JWT session strategy is incompatible with database adapters.
 *
 * The issue: When a database adapter is present, NextAuth v5 tries to create a
 * database session record for Credentials logins, but the Credentials provider
 * doesn't support the adapter's createUser/linkAccount flow. This results in the
 * JWT token not being properly set in the cookie, causing a redirect loop back
 * to the login page.
 *
 * The fix: Remove the adapter entirely. User data is still read from MongoDB
 * in the authorize() callback. Session data is stored in JWT cookies only.
 * The adapter was only needed for OAuth providers (Google, GitHub, etc.) which
 * we're not using.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // No adapter — JWT-only sessions for Credentials provider
  providers: [
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const db = await getDb();
        const user = await db.collection('users').findOne({ email: credentials.email });

        if (!user) {
          return null;
        }

        const userId = user._id.toString();

        if (!user.passwordHash) {
          return null;
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password as string,
          user.passwordHash
        );

        if (!isPasswordValid) {
          return null;
        }

        return {
          id: userId,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image,
        };
      },
    }),
  ],
});
