import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { ENV } from '../utils/env';
import * as schema from './schema';

// Create the Neon HTTP client
const sql = neon(ENV.DATABASE_URL);

// Create the Drizzle database instance with proper typing
export const db = drizzle(sql as any, { schema });

// Export types
export type Database = typeof db;
export { schema };

