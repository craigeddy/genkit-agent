import { z, type GenkitBeta, type ToolAction } from 'genkit/beta';

export interface OrderRecord {
  orderId: string;
  customerName: string;
  items: string[];
  status: 'processing' | 'in_transit' | 'out_for_delivery' | 'delivered';
  carrier: string;
  trackingNumber: string;
  estimatedDelivery: string;
  shippingAddress: string;
}

export interface InvoiceRecord {
  invoiceId: string;
  orderId: string;
  amountUsd: number;
  status: 'paid' | 'refunded' | 'disputed';
  chargedAt: string;
  paymentMethod: string;
}

export interface SupportTicket {
  ticketId: string;
  issueSummary: string;
  severity: 'low' | 'medium' | 'high';
  status: 'open' | 'escalated';
  createdAt: string;
}

// In-memory mock databases for deterministic demo and testing
export const ORDERS_DB: Record<string, OrderRecord> = {
  'ORD-1001': {
    orderId: 'ORD-1001',
    customerName: 'Alex Rivera',
    items: ['Pixel Buds Pro 2', 'USB-C Fast Charger'],
    status: 'in_transit',
    carrier: 'FedEx',
    trackingNumber: 'FX-9988776655',
    estimatedDelivery: '2026-10-25',
    shippingAddress: '742 Evergreen Terrace, Springfield',
  },
  'ORD-1002': {
    orderId: 'ORD-1002',
    customerName: 'Alex Rivera',
    items: ['Mechanical Keyboard MK-88'],
    status: 'delivered',
    carrier: 'UPS',
    trackingNumber: '1Z-4433221100',
    estimatedDelivery: '2026-10-20',
    shippingAddress: '742 Evergreen Terrace, Springfield',
  },
};

export const INVOICES_DB: Record<string, InvoiceRecord> = {
  'INV-5001': {
    invoiceId: 'INV-5001',
    orderId: 'ORD-1001',
    amountUsd: 249.0,
    status: 'paid',
    chargedAt: '2026-10-21',
    paymentMethod: 'Visa ending in 4242',
  },
  'INV-5002': {
    invoiceId: 'INV-5002',
    orderId: 'ORD-1002',
    amountUsd: 129.5,
    status: 'paid',
    chargedAt: '2026-10-18',
    paymentMethod: 'Visa ending in 4242',
  },
};

export const KNOWLEDGE_BASE: Array<{ id: string; topic: string; keywords: string[]; solution: string }> = [
  {
    id: 'KB-101',
    topic: 'Pixel Buds Pro 2 Bluetooth Pairing & Audio Dropouts',
    keywords: ['bluetooth', 'pairing', 'pixel buds', 'audio', 'disconnect', 'reset', 'earbuds'],
    solution:
      '1. Place both earbuds in the charging case and leave the case open. 2. Press and hold the back pairing button for 3 seconds until the status light pulses white. 3. For firmware resets, hold the button for 30 seconds until the light flashes amber and white.',
  },
  {
    id: 'KB-102',
    topic: 'Mechanical Keyboard MK-88 Firmware & Key Chatter Fix',
    keywords: ['keyboard', 'mk-88', 'firmware', 'keys', 'typing', 'usb'],
    solution:
      'Hold Fn + Esc for 5 seconds to reset the onboard controller, then toggle the polling rate switch on the back from 1000Hz to 500Hz.',
  },
];

export const TICKETS_DB: SupportTicket[] = [];

export interface DomainTools {
  lookupOrderTool: ToolAction<any, any>;
  rescheduleDeliveryTool: ToolAction<any, any>;
  getInvoiceTool: ToolAction<any, any>;
  issueRefundTool: ToolAction<any, any>;
  searchKnowledgeBaseTool: ToolAction<any, any>;
  createSupportTicketTool: ToolAction<any, any>;
}

/**
 * Registers all domain-specific tools on the provided Genkit instance.
 */
export function registerDomainTools(ai: GenkitBeta): DomainTools {
  // --- Order & Shipping Tools ---
  const lookupOrderTool = ai.defineTool(
    {
      name: 'lookupOrderTool',
      description: 'Look up order details, shipping status, carrier, and estimated delivery date by order ID.',
      inputSchema: z.object({
        orderId: z.string().describe('The order ID, e.g., ORD-1001'),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        order: z
          .object({
            orderId: z.string(),
            customerName: z.string(),
            items: z.array(z.string()),
            status: z.string(),
            carrier: z.string(),
            trackingNumber: z.string(),
            estimatedDelivery: z.string(),
            shippingAddress: z.string(),
          })
          .optional(),
        message: z.string().optional(),
      }),
    },
    async ({ orderId }) => {
      const normalized = orderId.trim().toUpperCase();
      const order = ORDERS_DB[normalized];
      if (!order) {
        return {
          found: false,
          message: `No order found with ID ${normalized}. Available sample IDs: ${Object.keys(ORDERS_DB).join(', ')}`,
        };
      }
      return { found: true, order };
    }
  );

  const rescheduleDeliveryTool = ai.defineTool(
    {
      name: 'rescheduleDeliveryTool',
      description: 'Update the estimated delivery date for an in-transit order.',
      inputSchema: z.object({
        orderId: z.string().describe('The order ID, e.g., ORD-1001'),
        newDeliveryDate: z.string().describe('Requested delivery date in YYYY-MM-DD format'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        orderId: z.string(),
        updatedDeliveryDate: z.string().optional(),
        message: z.string(),
      }),
    },
    async ({ orderId, newDeliveryDate }) => {
      const normalized = orderId.trim().toUpperCase();
      const order = ORDERS_DB[normalized];
      if (!order) {
        return {
          success: false,
          orderId: normalized,
          message: `Order ${normalized} not found.`,
        };
      }
      order.estimatedDelivery = newDeliveryDate;
      return {
        success: true,
        orderId: normalized,
        updatedDeliveryDate: newDeliveryDate,
        message: `Delivery for order ${normalized} (${order.carrier} ${order.trackingNumber}) has been rescheduled to ${newDeliveryDate}.`,
      };
    }
  );

  // --- Billing & Refunds Tools ---
  const getInvoiceTool = ai.defineTool(
    {
      name: 'getInvoiceTool',
      description: 'Fetch billing invoice details by invoice ID (e.g., INV-5001) or order ID (e.g., ORD-1002).',
      inputSchema: z.object({
        identifier: z.string().describe('Invoice ID (INV-5001) or Order ID (ORD-1002)'),
      }),
      outputSchema: z.object({
        found: z.boolean(),
        invoice: z
          .object({
            invoiceId: z.string(),
            orderId: z.string(),
            amountUsd: z.number(),
            status: z.string(),
            chargedAt: z.string(),
            paymentMethod: z.string(),
          })
          .optional(),
        message: z.string().optional(),
      }),
    },
    async ({ identifier }) => {
      const norm = identifier.trim().toUpperCase();
      const invoice =
        INVOICES_DB[norm] || Object.values(INVOICES_DB).find((inv) => inv.orderId === norm);
      if (!invoice) {
        return {
          found: false,
          message: `No invoice found for ${norm}. Available invoices: ${Object.keys(INVOICES_DB).join(', ')}`,
        };
      }
      return { found: true, invoice };
    }
  );

  const issueRefundTool = ai.defineTool(
    {
      name: 'issueRefundTool',
      description: 'Process a refund for a paid invoice and return a refund confirmation ID.',
      inputSchema: z.object({
        invoiceId: z.string().describe('The invoice ID to refund, e.g., INV-5002'),
        reason: z.string().describe('Reason for the refund'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        refundId: z.string().optional(),
        amountRefundedUsd: z.number().optional(),
        message: z.string(),
      }),
    },
    async ({ invoiceId, reason }) => {
      const norm = invoiceId.trim().toUpperCase();
      const invoice = INVOICES_DB[norm];
      if (!invoice) {
        return {
          success: false,
          message: `Invoice ${norm} not found.`,
        };
      }
      if (invoice.status === 'refunded') {
        return {
          success: false,
          message: `Invoice ${norm} has already been refunded.`,
        };
      }
      invoice.status = 'refunded';
      const refundId = `REF-${norm.replace('INV-', '')}-OK`;
      return {
        success: true,
        refundId,
        amountRefundedUsd: invoice.amountUsd,
        message: `Refund ${refundId} for $${invoice.amountUsd.toFixed(2)} processed to ${invoice.paymentMethod} (Reason: ${reason}).`,
      };
    }
  );

  // --- Technical Support Tools ---
  const searchKnowledgeBaseTool = ai.defineTool(
    {
      name: 'searchKnowledgeBaseTool',
      description: 'Search technical troubleshooting articles by product name or symptom keywords.',
      inputSchema: z.object({
        query: z.string().describe('Search keywords, e.g., "pixel buds bluetooth reset"'),
      }),
      outputSchema: z.object({
        results: z.array(
          z.object({
            id: z.string(),
            topic: z.string(),
            solution: z.string(),
          })
        ),
      }),
    },
    async ({ query }) => {
      const terms = query.toLowerCase().split(/\s+/);
      const matches = KNOWLEDGE_BASE.filter((entry) =>
        terms.some(
          (term) =>
            entry.topic.toLowerCase().includes(term) ||
            entry.keywords.some((kw) => kw.includes(term))
        )
      );
      return {
        results: (matches.length > 0 ? matches : KNOWLEDGE_BASE).map(({ id, topic, solution }) => ({
          id,
          topic,
          solution,
        })),
      };
    }
  );

  const createSupportTicketTool = ai.defineTool(
    {
      name: 'createSupportTicketTool',
      description: 'Create an engineering escalation support ticket when a hardware or software issue persists.',
      inputSchema: z.object({
        issueSummary: z.string().describe('Summary of the customer technical issue'),
        severity: z.enum(['low', 'medium', 'high']).describe('Severity level of the issue'),
      }),
      outputSchema: z.object({
        ticketId: z.string(),
        status: z.string(),
        message: z.string(),
      }),
    },
    async ({ issueSummary, severity }) => {
      const ticketId = `TCK-${900 + TICKETS_DB.length + 1}`;
      const ticket: SupportTicket = {
        ticketId,
        issueSummary,
        severity,
        status: 'escalated',
        createdAt: new Date().toISOString(),
      };
      TICKETS_DB.push(ticket);
      return {
        ticketId,
        status: ticket.status,
        message: `Escalation ticket ${ticketId} created with ${severity} severity: "${issueSummary}".`,
      };
    }
  );

  return {
    lookupOrderTool,
    rescheduleDeliveryTool,
    getInvoiceTool,
    issueRefundTool,
    searchKnowledgeBaseTool,
    createSupportTicketTool,
  };
}
