#!/usr/bin/env node

/**
 * SQLite Database Backup Script
 *
 * Usage:
 *   node scripts/backup-database.js
 *   node scripts/backup-database.js --output ./backups
 *   node scripts/backup-database.js --compress
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const outputFlag = args.indexOf('--output');
const compressFlag = args.includes('--compress');

let outputDir = './backups';
if (outputFlag !== -1 && args[outputFlag + 1]) {
    outputDir = args[outputFlag + 1];
}

// Configuration
const PROJECT_ROOT = path.dirname(__dirname);
const DB_NAME = 'agent.db';
const DB_PATH = path.join(PROJECT_ROOT, DB_NAME);
const BACKUP_DIR = path.join(PROJECT_ROOT, outputDir);

// Create backup directory if it doesn't exist
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// Generate backup filename with timestamp
function generateBackupFilename() {
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return `${DB_NAME}.${timestamp}`;
}

// Perform backup using file copy
function backupDatabase() {
    const backupFilename = generateBackupFilename();
    const backupPath = path.join(BACKUP_DIR, backupFilename);

    console.log(`[Backup] Starting database backup...`);
    console.log(`[Backup] Source: ${DB_PATH}`);
    console.log(`[Backup] Destination: ${backupPath}`);

    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        console.error(`[Backup] Error: Database file not found at ${DB_PATH}`);
        process.exit(1);
    }

    try {
        // Copy database file
        fs.copyFileSync(DB_PATH, backupPath);

        // Get file stats
        const stats = fs.statSync(backupPath);
        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);

        console.log(`[Backup] Backup completed successfully!`);
        console.log(`[Backup] Size: ${sizeMB} MB`);
        console.log(`[Backup] Location: ${backupPath}`);

        // Optionally compress
        if (compressFlag) {
            console.log(`[Backup] Compression not yet implemented. Install zlib for compression.`);
        }

        // Clean up old backups (keep last 10)
        cleanupOldBackups(10);

        return backupPath;
    } catch (error) {
        console.error(`[Backup] Error during backup:`, error);
        process.exit(1);
    }
}

// Clean up old backups, keeping the most recent N
function cleanupOldBackups(keepCount) {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(file => file.startsWith(DB_NAME) && file !== DB_NAME)
        .map(file => ({
            name: file,
            path: path.join(BACKUP_DIR, file),
            time: fs.statSync(path.join(BACKUP_DIR, file)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time);

    if (files.length > keepCount) {
        const toDelete = files.slice(keepCount);
        console.log(`[Backup] Cleaning up ${toDelete.length} old backup(s)...`);
        toDelete.forEach(file => {
            fs.unlinkSync(file.path);
            console.log(`[Backup] Deleted: ${file.name}`);
        });
    }
}

// Create backup metadata file
function createMetadata(backupPath) {
    const metadata = {
        filename: path.basename(backupPath),
        created: new Date().toISOString(),
        size: fs.statSync(backupPath).size,
        database: DB_PATH,
        version: '1.0.0'
    };

    const metadataPath = backupPath + '.meta.json';
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log(`[Backup] Metadata saved: ${metadataPath}`);
}

// Main execution
try {
    const backupPath = backupDatabase();
    createMetadata(backupPath);
    console.log(`[Backup] All done!`);
} catch (error) {
    console.error(`[Backup] Fatal error:`, error);
    process.exit(1);
}
