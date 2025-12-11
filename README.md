<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1iL5s7t_xHxZJeqwbPxkT4u01u-8Ctdgz

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. **Configuration**:
   - Copy `.env.example` to `.env.local`.
   - See [SETUP.md](./SETUP.md) for details on Z.ai vs Gemini configuration.
   - Set `GEMINI_API_KEY` and `VITE_LLM_PROVIDER` appropriately.
3. Run the app:
   `npm run dev`
