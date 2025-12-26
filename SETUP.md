# CI-Fixer Setup Guide

## 1. Environment Configuration

### LLM Provider
You can choose between **Google Gemini** (default) or **Z.ai (GLM-4.7)**.

**For Z.ai (Recommended for Coding specific tasks):**
1.  Set `VITE_LLM_PROVIDER=zai` in `.env.local`.
2.  Obtain an API Key from [Z.ai Dashboard](https://z.ai/manage-apikey/apikey-list).
    *   **CRITICAL**: Ensure you have subscribed to the **Coding Plan**. The standard free/paid keys may not support the `Coding Plan` model (`GLM-4.7`).
3.  Set `GEMINI_API_KEY=your_z_ai_key` in `.env.local` (We reuse the variable name for simplicity).

**For Gemini:**
1.  Set `VITE_LLM_PROVIDER=gemini` (or leave undefined).
2.  Set `GEMINI_API_KEY=your_google_key`.

### Other Services
Ensure you have keys for:
- [E2B](https://e2b.dev) (`E2B_API_KEY`)
- [Tavily](https://tavily.com) (`TAVILY_API_KEY`)
- GitHub Token (`GITHUB_TOKEN`)

## 2. Database Initialization
The application uses **SQLite** with **Prisma**. You must initialize the database file before running the server:

```bash
# Creates agent.db
npx prisma db push
```

## 3. Verification
Run the integration test suite to verify your keys and connectivity:
```bash
npx vitest run __tests__/integration/mvp_full_stack.test.ts
```

## 3. Running the App
```bash
npm run dev
```
