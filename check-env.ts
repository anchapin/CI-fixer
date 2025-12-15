
import dotenv from 'dotenv';
import path from 'path';

console.log('Loading .env.local...');
const result = dotenv.config({ path: '.env.local', override: true });

if (result.error) {
    console.error('Error loading .env.local:', result.error);
} else {
    console.log('.env.local loaded successfully.');
}

console.log('DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:]+@/, ':***@') : 'UNDEFINED');
console.log('Direct Check:', process.env.DATABASE_URL);
