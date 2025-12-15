
import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');

try {
    let content = fs.readFileSync(envPath, 'utf8');

    // Check if Postgres URL exists
    if (content.includes('postgresql://user:password@localhost:5432/cifixer')) {
        console.log('Found incorrect Postgres URL. Replacing...');
        content = content.replace(
            'postgresql://user:password@localhost:5432/cifixer',
            'file:./agent.db'
        );
        fs.writeFileSync(envPath, content);
        console.log('Successfully updated .env.local');
    } else if (content.includes('postgresql://')) {
        console.log('Found some Postgres URL but not exact match. Attempting generic replacement...');
        // Regex replacement for any postgres url
        content = content.replace(/postgresql:\/\/[^\s"]+/, 'file:./agent.db');
        fs.writeFileSync(envPath, content);
        console.log('Updated .env.local via regex');
    } else {
        console.log('No Postgres URL found in .env.local. Content might already be correct or different format.');
        // console.log(content); // Don't print secrets
    }

} catch (e) {
    console.error('Failed to update .env.local:', e);
}
