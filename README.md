# Genkit Multi-Agent Handoff & Routing Example

A TypeScript project demonstrating a **Multi-Agent Triage & Specialist Handoff** system built with **Firebase Genkit** (`genkit/beta`) and **Google AI (Gemini)**.

## Architecture Overview

In Genkit's Agents & Multi-Agent paradigm, specialized agents are defined as prompts/agents with their own domain instructions and tools, and exposed as **callable handoff tools** to a front-desk **Triage / Coordinator Agent**:

1. **Triage Coordinator Agent (`triageAgent`)**
   - Acts as the primary conversational entry point (`ai.chat(triageAgent)`).
   - Analyzes user intent and dynamically routes/hands off requests to the right specialist agent.
2. **Order & Shipping Specialist Agent (`orderSupportAgent`)**
   - Equipped with `lookupOrderTool` and `rescheduleDeliveryTool`.
   - Handles order tracking, delivery status, and address/date changes.
3. **Billing & Refunds Specialist Agent (`billingSpecialistAgent`)**
   - Equipped with `getInvoiceTool` and `issueRefundTool`.
   - Handles invoice inquiries, duplicate charges, and refund processing.
4. **Technical Support Specialist Agent (`techSupportAgent`)**
   - Equipped with `searchKnowledgeBaseTool` and `createSupportTicketTool`.
   - Troubleshoots product issues and escalates bugs to engineering.

## Project Structure

- `src/tools.ts` — Domain tools (`defineTool`) for orders, billing, and technical support with mock data stores.
- `src/agents.ts` — Genkit instance, specialist agents (`orderSupportAgent`, `billingSpecialistAgent`, `techSupportAgent`), and the orchestrator (`triageAgent`), plus a multi-turn flow (`multiAgentSupportFlow`).
- `src/index.ts` — Automated multi-turn demo script showcasing agent handoffs across Order, Billing, and Tech Support domains.
- `src/cli.ts` — Interactive terminal chat CLI where you can converse with the multi-agent system in real time.
- `src/test.ts` — Verification test suite validating tool execution, agent registration, and multi-agent routing.

## Quick Start

### 1. Create and Configure Your Gemini API Key

#### Recommended: Create a Key in Google AI Studio
1. Go to **[Google AI Studio — API Keys](https://aistudio.google.com/apikey)** and sign in with your Google account.
2. Click **Create API key** and select either a new project or an existing Google Cloud project.
   - *Note on key prefixes:* Google AI Studio may generate keys starting with `AIza...` or `AQ....`. Both work with the default Google AI Studio (`generativelanguage.googleapis.com`) plugin in this project.
   - *Avoid restricting the key initially:* If you view the key in [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), ensure **API restrictions** is either set to **Don't restrict key** or explicitly includes the **Generative Language API** (`generativelanguage.googleapis.com`).
3. Copy `.env.example` to `.env` (which is git-ignored) and paste your key:
   ```bash
   cp .env.example .env
   ```
   ```env
   GEMINI_API_KEY=your_actual_api_key_here
   ```

#### Optional Environment Variables
- `GEMINI_MODEL`: Defaults to `gemini-flash-latest` (recommended, as older pinned versions like `gemini-2.5-flash` are retired for newly created Google AI Studio accounts in favor of `gemini-3.8-flash` / `gemini-flash-latest`).
- `USE_VERTEX_AI=true`: Set this **only** if you created a Vertex AI Express Mode key in Google Cloud Console (`aiplatform.googleapis.com`). If you use Vertex AI instead of Google AI Studio:
  1. Enable the **Vertex AI API** (`aiplatform.googleapis.com`) on your Google Cloud project.
  2. If your `AQ....` key is bound to a service account, grant that service account the **Vertex AI User** (`roles/aiplatform.user` / `aiplatform.endpoints.predict`) role in **IAM & Admin → IAM**.

*(Note: If `GEMINI_API_KEY` is omitted, `npm start` and `npm test` automatically fall back to a built-in local mock model with realistic tool-call handoffs so you can test the Genkit agent routing pipeline offline.)*

### 2. Run the Multi-Turn Handoff Demo

```bash
npm start
```

### 3. Run the Interactive Chat CLI

```bash
npm run chat
```

### 4. Run Verification Tests & Typecheck

```bash
npm test
npm run typecheck
```
