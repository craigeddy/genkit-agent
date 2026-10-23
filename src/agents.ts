import 'dotenv/config';
import {
  genkit,
  z,
  InMemorySessionStore,
  type Agent,
  type ToolAction,
  type Part,
} from 'genkit/beta';
import { googleAI, vertexAI } from '@genkit-ai/google-genai';
import { registerDomainTools } from './tools.js';
import { emitAgentStatus } from './progress.js';

export interface HandoffEvent {
  timestamp: string;
  fromAgent: string;
  toAgent: string;
  task: string;
  specialistToolsUsed: string[];
  summary: string;
}

// Track handoffs during execution for observability in CLI / demo / tests
export const handoffLog: HandoffEvent[] = [];

const configuredKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();

export const hasGeminiApiKey = Boolean(
  configuredKey && configuredKey !== 'your_gemini_api_key_here'
);

export const isVertexExpressKey = process.env.USE_VERTEX_AI === 'true';

export const useLiveGemini = hasGeminiApiKey && process.env.USE_MOCK_MODEL !== 'true';

/**
 * Initialize Genkit Beta with Google AI Studio (or Vertex AI if USE_VERTEX_AI=true).
 */
export const ai = genkit({
  plugins: useLiveGemini
    ? [isVertexExpressKey ? vertexAI({ apiKey: configuredKey }) : googleAI({ apiKey: configuredKey })]
    : [],
});

/**
 * Register a local tool-aware simulation model so the multi-agent handoff
 * pipeline can be tested and demonstrated even before a GEMINI_API_KEY is configured.
 */
export const mockAgentModel = ai.defineModel(
  {
    name: 'mock/gemini-agent-router',
    label: 'Mock Gemini Multi-Agent Router (Offline Mode)',
    supports: {
      multiturn: true,
      tools: true,
      systemRole: true,
    },
  },
  async (request, streamingCallback) => {
    const messages = request.messages || [];
    const systemMsg = messages.find((m) => m.role === 'system');
    const systemText = systemMsg?.content.map((p) => p.text || '').join(' ') || '';

    const lastMsg = messages[messages.length - 1];
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    const userText = lastUserMsg?.content.map((p) => p.text || '').join(' ') || '';

    // 1. If the most recent message is a tool response, synthesize the agent's reply from the tool output
    if (lastMsg?.role === 'tool') {
      const toolResponses = lastMsg.content
        .map((p) => p.toolResponse)
        .filter((tr): tr is NonNullable<typeof tr> => Boolean(tr));

      // Check if we are in a specialist agent that still needs a second tool call (e.g., lookup -> action)
      if (systemText.includes('Order & Shipping Specialist')) {
        const lookupResp = toolResponses.find((tr) => tr.name === 'lookupOrderTool');
        const dateMatch = userText.match(/(\d{4}-\d{2}-\d{2})/);
        if (
          lookupResp &&
          dateMatch &&
          (userText.toLowerCase().includes('reschedule') ||
            userText.toLowerCase().includes('change') ||
            userText.toLowerCase().includes('move'))
        ) {
          const out = lookupResp.output as any;
          const orderId = out?.order?.orderId || 'ORD-1001';
          return {
            finishReason: 'stop',
            message: {
              role: 'model',
              content: [
                {
                  toolRequest: {
                    name: 'rescheduleDeliveryTool',
                    input: { orderId, newDeliveryDate: dateMatch[1] },
                  },
                },
              ],
            },
          };
        }
      }

      if (systemText.includes('Billing & Refunds Specialist')) {
        const invResp = toolResponses.find((tr) => tr.name === 'getInvoiceTool');
        if (
          invResp &&
          (userText.toLowerCase().includes('refund') || userText.toLowerCase().includes('return'))
        ) {
          const out = invResp.output as any;
          const invoiceId = out?.invoice?.invoiceId || 'INV-5002';
          return {
            finishReason: 'stop',
            message: {
              role: 'model',
              content: [
                {
                  toolRequest: {
                    name: 'issueRefundTool',
                    input: {
                      invoiceId,
                      reason: 'Customer requested refund via support triage',
                    },
                  },
                },
              ],
            },
          };
        }
      }

      if (systemText.includes('Technical Support Specialist')) {
        const kbResp = toolResponses.find((tr) => tr.name === 'searchKnowledgeBaseTool');
        if (
          kbResp &&
          (userText.toLowerCase().includes('ticket') ||
            userText.toLowerCase().includes('escalate') ||
            userText.toLowerCase().includes('still broken'))
        ) {
          return {
            finishReason: 'stop',
            message: {
              role: 'model',
              content: [
                {
                  toolRequest: {
                    name: 'createSupportTicketTool',
                    input: {
                      issueSummary: userText,
                      severity: 'high',
                    },
                  },
                },
              ],
            },
          };
        }
      }

      // Format final text response from tool outputs
      const summaryParts = toolResponses.map((tr) => {
        const out = tr.output as any;
        if (tr.name.startsWith('delegate_to_')) {
          return `[Routed via ${out.agent}] ${out.response}`;
        }
        if (out?.message) {
          return out.message;
        }
        if (out?.order) {
          const o = out.order;
          return `Order ${o.orderId} (${o.items.join(', ')}) is currently ${o.status} via ${o.carrier} (Tracking: ${o.trackingNumber}), estimated delivery: ${o.estimatedDelivery}.`;
        }
        if (out?.invoice) {
          const inv = out.invoice;
          return `Invoice ${inv.invoiceId} for Order ${inv.orderId}: $${inv.amountUsd.toFixed(2)} (${inv.status}) charged on ${inv.chargedAt} to ${inv.paymentMethod}.`;
        }
        if (out?.results) {
          const first = out.results[0];
          return `Troubleshooting guide (${first.id} - ${first.topic}): ${first.solution}`;
        }
        return JSON.stringify(out);
      });

      const finalText = summaryParts.join('\n');
      if (streamingCallback) {
        streamingCallback({ content: [{ text: finalText }] });
      }
      return {
        finishReason: 'stop',
        message: {
          role: 'model',
          content: [{ text: finalText }],
        },
      };
    }

    // 2. First turn of a specialist or triage agent: decide which tool to call
    const lower = userText.toLowerCase();
    const orderIdMatch = userText.match(/ORD-\d+/i);
    const invoiceIdMatch = userText.match(/INV-\d+/i);

    // Triage Coordinator routing logic
    if (systemText.includes('Triage Coordinator')) {
      let targetTool = 'delegate_to_orderSupportAgent';
      if (
        lower.includes('refund') ||
        lower.includes('invoice') ||
        lower.includes('charge') ||
        lower.includes('billing') ||
        invoiceIdMatch
      ) {
        targetTool = 'delegate_to_billingSpecialistAgent';
      } else if (
        lower.includes('bluetooth') ||
        lower.includes('pair') ||
        lower.includes('reset') ||
        lower.includes('broken') ||
        lower.includes('issue') ||
        lower.includes('ticket') ||
        lower.includes('escalate') ||
        lower.includes('keyboard') ||
        lower.includes('earbuds')
      ) {
        targetTool = 'delegate_to_techSupportAgent';
      }

      return {
        finishReason: 'stop',
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: targetTool,
                input: {
                  task: userText,
                },
              },
            },
          ],
        },
      };
    }

    // Order Specialist logic
    if (systemText.includes('Order & Shipping Specialist')) {
      const orderId = orderIdMatch ? orderIdMatch[0].toUpperCase() : 'ORD-1001';
      return {
        finishReason: 'stop',
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: 'lookupOrderTool',
                input: { orderId },
              },
            },
          ],
        },
      };
    }

    // Billing Specialist logic
    if (systemText.includes('Billing & Refunds Specialist')) {
      const identifier = invoiceIdMatch
        ? invoiceIdMatch[0].toUpperCase()
        : orderIdMatch
          ? orderIdMatch[0].toUpperCase()
          : 'INV-5002';
      return {
        finishReason: 'stop',
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: 'getInvoiceTool',
                input: { identifier },
              },
            },
          ],
        },
      };
    }

    // Technical Support Specialist logic
    if (systemText.includes('Technical Support Specialist')) {
      return {
        finishReason: 'stop',
        message: {
          role: 'model',
          content: [
            {
              toolRequest: {
                name: 'searchKnowledgeBaseTool',
                input: { query: userText },
              },
            },
          ],
        },
      };
    }

    const fallbackText = `Processed request: "${userText}"`;
    if (streamingCallback) {
      streamingCallback({ content: [{ text: fallbackText }] });
    }
    return {
      finishReason: 'stop',
      message: {
        role: 'model',
        content: [{ text: fallbackText }],
      },
    };
  }
);

export const activeModelName = process.env.GEMINI_MODEL || 'gemini-flash-latest';

export const activeModel = useLiveGemini
  ? isVertexExpressKey
    ? vertexAI.model(activeModelName)
    : googleAI.model(activeModelName)
  : mockAgentModel;

// Shared in-memory session store for stateful multi-turn agent sessions
export const sessionStore = new InMemorySessionStore();

// Register domain tools
export const domainTools = registerDomainTools(ai);

/**
 * Specialist Agent 1: Order & Shipping Specialist
 * Defined with `ai.defineAgent` from `genkit/beta`.
 */
export const orderSupportAgent = ai.defineAgent({
  name: 'orderSupportAgent',
  description:
    'Specialist agent for order tracking, delivery status checks, carrier info, and rescheduling delivery dates.',
  model: activeModel,
  store: sessionStore,
  tools: [domainTools.lookupOrderTool, domainTools.rescheduleDeliveryTool],
  system: `You are the Order & Shipping Specialist agent.
Always use your tools (lookupOrderTool, rescheduleDeliveryTool) to inspect and update order status accurately.
Provide concise, helpful updates including the order ID, carrier, tracking number, and delivery date.`,
});

/**
 * Specialist Agent 2: Billing & Refunds Specialist
 * Defined with `ai.defineAgent` from `genkit/beta`.
 */
export const billingSpecialistAgent = ai.defineAgent({
  name: 'billingSpecialistAgent',
  description:
    'Specialist agent for billing inquiries, looking up invoices, verifying charges, and issuing customer refunds.',
  model: activeModel,
  store: sessionStore,
  tools: [domainTools.getInvoiceTool, domainTools.issueRefundTool],
  system: `You are the Billing & Refunds Specialist agent.
Use getInvoiceTool to verify invoice details and issueRefundTool when the customer asks for a refund.
Always include the invoice ID, dollar amount, and refund confirmation ID in your answer.`,
});

/**
 * Specialist Agent 3: Technical Support Specialist
 * Defined with `ai.defineAgent` from `genkit/beta`.
 */
export const techSupportAgent = ai.defineAgent({
  name: 'techSupportAgent',
  description:
    'Specialist agent for hardware/software troubleshooting, knowledge base lookups, and engineering ticket escalations.',
  model: activeModel,
  store: sessionStore,
  tools: [domainTools.searchKnowledgeBaseTool, domainTools.createSupportTicketTool],
  system: `You are the Technical Support Specialist agent.
First search the knowledge base using searchKnowledgeBaseTool.
If the user explicitly asks to escalate or open a support ticket, call createSupportTicketTool and share the ticket ID.`,
});

/**
 * Wraps a Genkit `Agent` (created via `ai.defineAgent`) into a callable delegation tool
 * (`delegate_to_<agentName>`) so an orchestrator/triage agent can hand off tasks to it.
 */
export function createAgentHandoffTool(
  targetAgent: Agent<any>,
  agentName: string,
  agentDescription: string
): ToolAction<any, any> {
  return ai.defineTool(
    {
      name: `delegate_to_${agentName}`,
      description: `Hand off/delegate a task to ${agentName}: ${agentDescription}`,
      inputSchema: z.object({
        task: z
          .string()
          .describe('The full customer request and relevant context to hand off to the specialist agent.'),
      }),
      outputSchema: z.object({
        agent: z.string(),
        response: z.string(),
        toolsUsed: z.array(z.string()),
        sessionId: z.string().optional(),
      }),
    },
    async ({ task }) => {
      emitAgentStatus(`Handing off to ${agentName}...`);
      // Start a specialist agent chat session via the Genkit Agents API
      const specialistChat = targetAgent.chat();
      const result = await specialistChat.send(task);
      emitAgentStatus(`${agentName} completed task — synthesizing response...`);

      // Retrieve the full session history from the snapshot store to inspect intermediate tool calls
      const snap = result.snapshotId
        ? await targetAgent.getSnapshot(result.snapshotId)
        : undefined;
      const historyMessages = snap?.state?.messages ?? result.messages;

      // Extract which domain tools the specialist invoked during its turn
      const toolsUsed: string[] = [];
      for (const msg of historyMessages) {
        for (const part of msg.content as Part[]) {
          if (part.toolRequest?.name) {
            toolsUsed.push(part.toolRequest.name);
          }
        }
      }

      handoffLog.push({
        timestamp: new Date().toISOString(),
        fromAgent: 'triageAgent',
        toAgent: agentName,
        task,
        specialistToolsUsed: toolsUsed,
        summary: result.text,
      });

      return {
        agent: agentName,
        response: result.text,
        toolsUsed,
        sessionId: specialistChat.sessionId,
      };
    }
  );
}

// Create handoff tools for the Triage Agent
export const delegateToOrdersTool = createAgentHandoffTool(
  orderSupportAgent,
  'orderSupportAgent',
  'Handles order status lookups, tracking numbers, and delivery date rescheduling.'
);

export const delegateToBillingTool = createAgentHandoffTool(
  billingSpecialistAgent,
  'billingSpecialistAgent',
  'Handles invoice lookups, billing questions, and processing refunds.'
);

export const delegateToTechSupportTool = createAgentHandoffTool(
  techSupportAgent,
  'techSupportAgent',
  'Handles product troubleshooting, reset instructions, and support ticket creation.'
);

/**
 * Orchestrator / Triage Coordinator Agent
 * Routes user conversations to the right specialist agent tool while maintaining multi-turn chat state.
 */
export const triageAgent = ai.defineAgent({
  name: 'triageAgent',
  description: 'Front-desk Triage Coordinator Agent that routes customer requests to specialist agents.',
  model: activeModel,
  store: sessionStore,
  tools: [delegateToOrdersTool, delegateToBillingTool, delegateToTechSupportTool],
  system: `You are the Triage Coordinator for Storefront AI Support.
Your job is to understand the customer's request and delegate it to the appropriate specialist agent tool:
- Use delegate_to_orderSupportAgent for order tracking, shipping status, or delivery date changes.
- Use delegate_to_billingSpecialistAgent for invoices, charges, or refund requests.
- Use delegate_to_techSupportAgent for product troubleshooting, pairing/reset steps, or opening support tickets.
Synthesize the specialist agent's findings clearly and politely for the customer.`,
});

/**
 * Optional Genkit Flow wrapper so the multi-agent router can also be invoked as a standard Genkit Flow.
 */
export const multiAgentSupportFlow = ai.defineFlow(
  {
    name: 'multiAgentSupportFlow',
    inputSchema: z.object({
      message: z.string().describe('Customer support message'),
      sessionId: z.string().optional().describe('Optional existing session ID to continue a conversation'),
    }),
    outputSchema: z.object({
      reply: z.string(),
      sessionId: z.string().optional(),
      routedToAgent: z.string().optional(),
      specialistToolsUsed: z.array(z.string()),
    }),
  },
  async ({ message, sessionId }) => {
    const beforeCount = handoffLog.length;
    const chat = sessionId
      ? await triageAgent.loadChat({ sessionId })
      : triageAgent.chat();

    const response = await chat.send(message);
    const latestHandoff = handoffLog.length > beforeCount ? handoffLog[handoffLog.length - 1] : undefined;

    return {
      reply: response.text,
      sessionId: chat.sessionId,
      routedToAgent: latestHandoff?.toAgent,
      specialistToolsUsed: latestHandoff?.specialistToolsUsed ?? [],
    };
  }
);
