import assert from 'node:assert/strict';
import {
  triageAgent,
  orderSupportAgent,
  billingSpecialistAgent,
  techSupportAgent,
  handoffLog,
  multiAgentSupportFlow,
} from './agents.js';
import { ORDERS_DB, INVOICES_DB, TICKETS_DB } from './tools.js';

async function runTests() {
  console.log('Running Genkit Multi-Agent verification tests...\n');

  // 1. Test direct specialist agent interaction (Order Specialist)
  console.log('Test 1: Direct Order Specialist Agent (`orderSupportAgent.chat().send(...)`)');
  const orderChat = orderSupportAgent.chat();
  const orderRes = await orderChat.send('Check status for ORD-1001');
  assert.ok(orderRes.text.includes('ORD-1001'), 'Expected response to mention ORD-1001');
  assert.ok(orderChat.sessionId, 'Expected orderChat to have a sessionId');
  console.log('  ✅ Passed:', orderRes.text);

  // 2. Test Triage Agent routing to Order Specialist + Rescheduling
  console.log('\nTest 2: Triage Agent handoff to Order Specialist with delivery reschedule');
  handoffLog.length = 0;
  const triageChat = triageAgent.chat();
  const turn1 = await triageChat.send(
    'Please check order ORD-1001 and reschedule delivery to 2026-10-29.'
  );
  assert.equal(handoffLog.length, 1, 'Expected 1 handoff event');
  assert.equal(handoffLog[0].toAgent, 'orderSupportAgent');
  assert.ok(handoffLog[0].specialistToolsUsed.includes('lookupOrderTool'));
  assert.ok(handoffLog[0].specialistToolsUsed.includes('rescheduleDeliveryTool'));
  assert.equal(ORDERS_DB['ORD-1001'].estimatedDelivery, '2026-10-29');
  assert.ok(turn1.text.includes('2026-10-29'));
  console.log('  ✅ Passed:', turn1.text);

  // 3. Test Triage Agent routing to Billing Specialist + Refund processing
  console.log('\nTest 3: Triage Agent handoff to Billing Specialist with refund issuance');
  const turn2 = await triageChat.send('I would like a refund on invoice INV-5002.');
  assert.equal(handoffLog.length, 2, 'Expected 2nd handoff event');
  assert.equal(handoffLog[1].toAgent, 'billingSpecialistAgent');
  assert.ok(handoffLog[1].specialistToolsUsed.includes('getInvoiceTool'));
  assert.ok(handoffLog[1].specialistToolsUsed.includes('issueRefundTool'));
  assert.equal(INVOICES_DB['INV-5002'].status, 'refunded');
  assert.ok(turn2.text.includes('REF-5002-OK'));
  console.log('  ✅ Passed:', turn2.text);

  // 4. Test Triage Agent streaming (`sendStream`) + routing to Tech Support Specialist
  console.log('\nTest 4: Triage Agent streaming (`sendStream`) & handoff to Tech Support Specialist');
  const streamTurn = triageChat.sendStream(
    'My Pixel Buds Bluetooth pairing is broken, please search help and escalate a ticket.'
  );
  let streamedText = '';
  for await (const chunk of streamTurn.stream) {
    if (chunk.text) {
      streamedText += chunk.text;
    }
  }
  const turn3 = await streamTurn.response;
  assert.equal(handoffLog.length, 3, 'Expected 3rd handoff event');
  assert.equal(handoffLog[2].toAgent, 'techSupportAgent');
  assert.ok(handoffLog[2].specialistToolsUsed.includes('searchKnowledgeBaseTool'));
  assert.ok(handoffLog[2].specialistToolsUsed.includes('createSupportTicketTool'));
  assert.equal(TICKETS_DB.length, 1);
  assert.ok(turn3.text.includes('TCK-901'));
  assert.ok(streamedText.length > 0, 'Expected non-empty streamed chunks');
  console.log('  ✅ Passed:', turn3.text);

  // 5. Test Session Persistence (`triageAgent.loadChat` & `multiAgentSupportFlow`)
  console.log('\nTest 5: Session resumption via `loadChat` and `multiAgentSupportFlow`');
  const savedSessionId = triageChat.sessionId!;
  const loadedChat = await triageAgent.loadChat({ sessionId: savedSessionId });
  assert.equal(loadedChat.sessionId, savedSessionId);
  assert.ok(loadedChat.messages.length >= 6, 'Expected conversation history to be preserved');

  const flowOut = await multiAgentSupportFlow({
    message: 'Check status of order ORD-1002',
    sessionId: savedSessionId,
  });
  assert.equal(flowOut.routedToAgent, 'orderSupportAgent');
  assert.ok(flowOut.reply.includes('ORD-1002'));
  console.log('  ✅ Passed:', flowOut.reply);

  console.log('\n🎉 All 5 Genkit Multi-Agent tests passed!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
