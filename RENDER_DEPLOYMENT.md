# Render Deployment Guide

## Disk Mounting Configuration

To deploy Doctor Dok on Render with persistent storage, follow these steps:

### 1. Environment Variables

Set the following environment variable in your Render service:

```
DATA_PATH=/app/data
```

### 2. Disk Mount Configuration

In your Render service settings:

- **Mount Path**: `/app/data`
- **Size**: 10GB (recommended starting size)
- **Type**: Persistent Disk

### 3. Application Changes

The application has been updated to support Render's disk mounting:

- **Database Provider** (`src/data/server/db-provider.ts`): Now uses `DATA_PATH` environment variable
- **Storage Service** (`src/lib/storage-service.ts`): Now uses `DATA_PATH` environment variable

Both components fall back to `process.cwd()` if `DATA_PATH` is not set, ensuring compatibility with local development.

### 4. Directory Structure

The application will automatically create the required directory structure under the mounted disk:

```
/app/data/
├── [database-id]/
│   ├── manifest.json
│   ├── db.sqlite
│   ├── [attachments]
│   └── [partition-folders]/
```

### 5. Key Benefits

- **Persistence**: All data persists across deployments and restarts
- **Scalability**: Easy to increase disk size as needed
- **Backup**: Render provides automatic backups of persistent disks
- **Performance**: Direct disk access for optimal database performance

### 6. Local Development

For local development, no changes are needed. The application will continue to use the current working directory when `DATA_PATH` is not set.

### 7. Verification

After deployment, you can verify the disk mounting is working by:

1. Checking that databases are created in `/app/data/[database-id]/`
2. Confirming file attachments are stored in the mounted path
3. Verifying data persists after service restarts 