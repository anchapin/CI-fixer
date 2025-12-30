# SQLite Database Backup Strategy

## Overview

This document defines the backup strategy for the CI-Fixer SQLite database, which stores:
- Agent runs and state
- Error facts and fix attempts
- Reflection learning patterns
- Metrics and telemetry

---

## Database Location

| Environment | Database File | Location |
|-------------|---------------|----------|
| Development | `agent.db` | Project root |
| Production | `agent.db` | Configurable via `DATABASE_URL` |

---

## Backup Strategy

### Automated Backups (Recommended)

#### Frequency
- **Development**: Daily backups (before work starts)
- **Production**: Hourly backups during active use

#### Retention
- **Daily backups**: Keep for 7 days
- **Weekly backups**: Keep for 4 weeks
- **Monthly backups**: Keep for 12 months

### Manual Backups

Trigger a manual backup before:
- Database migrations
- Retention cleanup operations
- Major deployments
- Experimental changes

---

## Backup Methods

### Method 1: File Copy (Simplest)

```bash
# Stop the application first (optional but recommended)
cp agent.db agent.db.backup.$(date +%Y%m%d_%H%M%S)
```

### Method 2: SQLite Backup API (Recommended)

Use the built-in SQLite backup API for online backups (no downtime required):

```bash
# Using the backup script
node scripts/backup-database.js
```

### Method 3: Prisma Export (For Portability)

```bash
# Export all data to JSON
npx prisma db pull  # Generate schema
# Then use a custom export script
```

---

## Backup Script

A backup script is provided at `scripts/backup-database.js`:

```bash
# Basic backup
node scripts/backup-database.js

# Custom output directory
node scripts/backup-database.js --output ./backups

# With compression
node scripts/backup-database.js --compress
```

---

## Backup Contents

Each backup includes:

1. **Database file**: `agent.db` (main SQLite database)
2. **Schema**: Prisma schema (`prisma/schema.prisma`)
3. **Metadata**: Backup timestamp, version, size

### Optional Components

4. **Configuration dump**: `.env` settings (excluding sensitive data)
5. **Metrics export**: OpenTelemetry metrics snapshot
6. **Log files**: Application logs for the period

---

## Restore Procedure

### Step 1: Stop the Application

```bash
# Stop any running instances
# pkill -f "node.*server"
```

### Step 2: Backup Current Database (Optional)

```bash
cp agent.db agent.db.before-restore.$(date +%Y%m%d_%H%M%S)
```

### Step 3: Restore from Backup

```bash
# Copy the backup file
cp backups/agent.db.20251230_120000 agent.db
```

### Step 4: Verify Restore

```bash
# Check database integrity
sqlite3 agent.db "PRAGMA integrity_check;"

# Verify tables
sqlite3 agent.db ".tables"
```

### Step 5: Restart Application

```bash
npm run dev
```

---

## Automated Backup Setup

### Linux/macOS (cron)

```bash
# Edit crontab
crontab -e

# Add hourly backup
0 * * * * cd /path/to/CI-fixer && node scripts/backup-database.js --compress
```

### Windows (Task Scheduler)

1. Open Task Scheduler
2. Create Basic Task
3. Trigger: Daily/Hourly
4. Action: Run `node scripts/backup-database.js`
5. Start in: `C:\path\to\CI-fixer`

---

## Backup Verification

Regularly verify backups by:

1. **Integrity check**: Run `PRAGMA integrity_check` on backup
2. **Restore test**: Test restore on a separate system
3. **Data verification**: Verify critical data exists

### Verification Script

```bash
# Run weekly verification
node scripts/verify-backup.js --backup ./backups/agent.db.20251230_120000
```

---

## Monitoring

Monitor backup operations via:

1. **OpenTelemetry metrics**: Track backup success/failure
2. **Logging**: All backup operations should be logged
3. **Health checks**: Include backup status in health endpoint

### Metrics to Track

- `database_backup_success_total` - Number of successful backups
- `database_backup_failure_total` - Number of failed backups
- `database_backup_size_bytes` - Size of backup files
- `database_backup_duration_seconds` - Time taken to complete backup

---

## Disaster Recovery

### Recovery Time Objective (RTO)

| Scenario | Target RTO |
|----------|------------|
| Database corruption | 15 minutes |
| Accidental deletion | 10 minutes |
| Server failure | 30 minutes |

### Recovery Point Objective (RPO)

- **Maximum data loss**: 1 hour (last backup)
- **Critical data**: 15 minutes (with continuous backup)

### Recovery Steps

1. Identify the last known good backup
2. Stop the application
3. Restore from backup (see Restore Procedure above)
4. Verify data integrity
5. Restart application
6. Validate application functionality

---

## Off-site Backup (Optional)

For production environments, consider:

1. **Cloud storage**: Upload backups to S3, GCS, or Azure Blob
2. **Remote server**: rsync to a remote location
3. **Backup service**: Use a dedicated backup service

### Example: S3 Upload

```bash
# After backup, upload to S3
aws s3 cp agent.db.backup.$(date +%Y%m%d) s3://my-bucket/ci-fixer-backups/
```

---

## Backup Security

1. **Encryption**: Encrypt backups containing sensitive data
2. **Access control**: Restrict backup file permissions (600)
3. **Secure storage**: Store backups in secure location
4. **Audit logging**: Log all backup/restore operations

### Encryption Example

```bash
# Encrypt backup
gpg --symmetric --cipher-algo AES256 agent.db.backup.20251230

# Decrypt backup
gpg --decrypt agent.db.backup.20251230.gpg > agent.db
```

---

## Related Documents

- [RETENTION_POLICY.md](./RETENTION_POLICY.md) - Data retention policy
- [DRR-2025-12-30-001](../.quint/decisions/DRR-2025-12-30-001-reflection-learning-persistence.md) - Implementation decision record
