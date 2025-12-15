---
title: "GitHub Permissions Fix"
category: "permissions"
requires_user: true
estimated_time: "3-5 minutes"
---

# GitHub Permissions Fix

This workflow helps resolve GitHub API permission errors when CI-fixer cannot access repository data or push fixes.

## When to Use

- Error: `Resource not accessible by integration`
- Error: `403 Forbidden`
- Error: `Bad credentials`
- Agent suggests: "GitHub token permissions insufficient"

## Prerequisites

- GitHub account with repository access
- Repository admin rights (for some permissions)

## Steps

### 1. Identify Required Permissions

Check the error message for specific permission needs:

- **Read repository**: `contents:read`, `metadata:read`
- **Push fixes**: `contents:write`
- **Access workflows**: `actions:read`, `actions:write`
- **Read/write checks**: `checks:read`, `checks:write`

### 2. Create New Personal Access Token

1. Go to GitHub Settings: https://github.com/settings/tokens
2. Click **"Generate new token"** → **"Generate new token (classic)"**
3. Set token name: `CI-Fixer Agent`
4. Set expiration: `90 days` (or custom)
5. Select scopes:

**Required scopes:**
- ✅ `repo` (Full control of private repositories)
  - Includes: `repo:status`, `repo_deployment`, `public_repo`, `repo:invite`
- ✅ `workflow` (Update GitHub Action workflows)
- ✅ `read:org` (Read org and team membership)

**Optional scopes:**
- ✅ `admin:repo_hook` (if using webhooks)

6. Click **"Generate token"**
7. **Copy the token immediately** (you won't see it again)

### 3. Update CI-fixer Configuration

**Option A: Environment Variable (Recommended)**

Update `.env.local`:
```bash
GITHUB_TOKEN=ghp_your_new_token_here
```

**Option B: Settings UI**

1. Start CI-fixer: `npm run dev`
2. Open http://localhost:5173
3. Click **Settings** (gear icon)
4. Paste token in **GitHub Token** field
5. Click **Save**

### 4. Verify Permissions

Test the token:

```bash
# Set token temporarily
export GITHUB_TOKEN=ghp_your_token_here

# Test repository access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO

# Test workflow access
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO/actions/runs
```

**Expected output:** JSON response with repository/workflow data (not 403/404)

### 5. Restart CI-fixer

```bash
# Stop current instance (Ctrl+C)
npm run dev
```

## Troubleshooting

### Error: Token doesn't have required scopes

**Solution:** Regenerate token with correct scopes (see Step 2)

### Error: Token expired

**Solution:** Generate new token and update `.env.local`

### Error: Repository not found (404)

**Possible causes:**
- Token doesn't have access to private repository
- Repository name is incorrect
- Organization requires SSO authorization

**SSO Authorization:**
1. Go to https://github.com/settings/tokens
2. Find your token
3. Click **"Configure SSO"**
4. Authorize for your organization

### Error: Rate limit exceeded

**Solution:** Wait 1 hour or use authenticated requests (token should prevent this)

## Fine-Grained Tokens (Alternative)

For better security, use fine-grained tokens:

1. Go to https://github.com/settings/tokens?type=beta
2. Click **"Generate new token"**
3. Set **Repository access**: Select specific repositories
4. Set **Permissions**:
   - Contents: Read and write
   - Metadata: Read-only
   - Actions: Read and write
   - Workflows: Read and write
5. Generate and copy token

## Verification

After updating token, trigger an agent run and verify:
- Agent can fetch workflow logs
- Agent can push fixes to repository
- No permission errors in logs

## Security Best Practices

- ✅ Use fine-grained tokens when possible
- ✅ Set expiration dates (90 days recommended)
- ✅ Never commit tokens to git
- ✅ Rotate tokens regularly
- ✅ Revoke unused tokens
- ❌ Don't share tokens
- ❌ Don't use tokens with excessive permissions
