import {
  triageAgent,
  handoffLog,
  useLiveGemini,
  activeModelName,
  multiAgentSupportFlow,
} from './agents.js';
import { AgentProgressIndicator, withAgentProgress } from './progress.js';

async function runMultiAgentDemo() {
  console.log('==============================================================');
  console.log(' 🤖 Genkit Agents API — Multi-Agent Handoff & Routing Demo');
  console.log('==============================================================');
  console.log(
    `Model Mode: ${
      useLiveGemini
        ? `Google AI (${activeModelName} via GEMINI_API_KEY)`
        : 'Local Mock Router (Set GEMINI_API_KEY in .env for live Gemini calls)'
    }\n`
  );

  // Start a stateful multi-turn conversation with the Triage Coordinator Agent
  const chat = triageAgent.chat();

  const prompts = [
    'Hi! Can you check the shipping status of my order ORD-1001 and reschedule delivery to 2026-10-28?',
    'Also, I need a refund for invoice INV-5002 from my keyboard order.',
    'One last thing: my Pixel Buds Pro 2 keep disconnecting from Bluetooth. How do I reset them, and can you open a ticket if it is still broken?',
  ];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    console.log(`--------------------------------------------------------------`);
    console.log(`🧑 Turn ${i + 1} (User): ${prompt}`);
    console.log(`--------------------------------------------------------------`);

    const prevHandoffs = handoffLog.length;

    if (i === prompts.length - 1) {
      // Demonstrate streaming on the final turn via `chat.sendStream()` with progress bar until first text token
      const progress = new AgentProgressIndicator();
      progress.start('Triage Coordinator analyzing request...');
      let startedStreamingText = false;

      try {
        const turn = chat.sendStream(prompt);
        for await (const chunk of turn.stream) {
          if (chunk.text) {
            if (!startedStreamingText) {
              progress.stop();
              process.stdout.write('🤖 Triage Agent (streaming): ');
              startedStreamingText = true;
            }
            process.stdout.write(chunk.text);
          }
        }
        progress.stop();
        const finalRes = await turn.response;
        console.log(`\n   [Session ID: ${finalRes.sessionId} | Snapshot ID: ${finalRes.snapshotId}]`);
      } finally {
        progress.stop();
      }
    } else {
      // Standard turn via `chat.send()` wrapped with live progress indicator
      const response = await withAgentProgress(
        'Triage Coordinator analyzing request...',
        () => chat.send(prompt)
      );
      console.log(`🤖 Triage Agent: ${response.text}`);
      console.log(`   [Session ID: ${response.sessionId} | Snapshot ID: ${response.snapshotId}]`);
    }

    const newHandoffs = handoffLog.slice(prevHandoffs);
    for (const h of newHandoffs) {
      console.log(
        `   ↳ 🔀 Handoff: ${h.fromAgent} -> ${h.toAgent} | Specialist Tools: [${h.specialistToolsUsed.join(', ')}]`
      );
    }
    console.log();
  }

  // Demonstrate invoking via the Genkit Flow wrapper as well (`multiAgentSupportFlow`)
  console.log('--------------------------------------------------------------');
  console.log('⚡ Invoking via Genkit Flow (resuming existing session):');
  console.log('--------------------------------------------------------------');
  const flowResult = await withAgentProgress(
    'Resuming session & routing request via Genkit Flow...',
    () =>
      multiAgentSupportFlow({
        message: 'Can you confirm the current delivery date on ORD-1001 now?',
        sessionId: chat.sessionId,
      })
  );
  console.log(`Flow Reply: ${flowResult.reply}`);
  console.log(
    `Routed To: ${flowResult.routedToAgent} | Specialist Tools: [${flowResult.specialistToolsUsed.join(', ')}]\n`
  );
}

runMultiAgentDemo().catch((err) => {
  console.error('Error running multi-agent demo:', err);
  process.exit(1);
});
