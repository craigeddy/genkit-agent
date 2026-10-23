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

### 1. Configure your Gemini API Key

Copy `.env.example` to `.env` and add your Google AI Studio API key:

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_actual_api_key_here
```

*(Note: If `GEMINI_API_KEY` is not set, `npm start` and `npm test` automatically use a built-in local mock model with realistic tool-call handoffs so you can test the full Genkit agent routing pipeline offline.)*

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
