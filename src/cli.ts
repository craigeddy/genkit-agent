import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { triageAgent, handoffLog, useLiveGemini } from './agents.js';

async function startInteractiveCli() {
  console.log('==============================================================');
  console.log(' 💬 Genkit Multi-Agent Interactive Chat CLI');
  console.log('==============================================================');
  console.log(
    `Active Model: ${
      useLiveGemini ? 'googleai/gemini-2.5-flash' : 'mock/gemini-agent-router (Offline Mode)'
    }`
  );
  console.log('Commands: /handoffs (view routing log), /history (message count), /exit (quit)\n');

  const chat = triageAgent.chat();
  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const userLine = (await rl.question('\n🧑 You: ')).trim();
      if (!userLine) continue;

      if (userLine === '/exit' || userLine === '/quit') {
        console.log('Goodbye!');
        break;
      }

      if (userLine === '/handoffs') {
        if (handoffLog.length === 0) {
          console.log('No agent handoffs recorded yet.');
        } else {
          console.table(
            handoffLog.map((h) => ({
              from: h.fromAgent,
              to: h.toAgent,
              tools: h.specialistToolsUsed.join(', '),
              task: h.task.slice(0, 45),
            }))
          );
        }
        continue;
      }

      if (userLine === '/history') {
        console.log(
          `Session ID: ${chat.sessionId ?? '(not started)'} | Messages in session: ${chat.messages.length}`
        );
        continue;
      }

      const prevCount = handoffLog.length;
      const response = await chat.send(userLine);
      const recentHandoffs = handoffLog.slice(prevCount);

      for (const h of recentHandoffs) {
        console.log(
          `   ↳ [Handoff: ${h.fromAgent} → ${h.toAgent} | Tools: ${h.specialistToolsUsed.join(', ')}]`
        );
      }
      console.log(`🤖 Agent: ${response.text}`);
    }
  } finally {
    rl.close();
  }
}

startInteractiveCli().catch((err) => {
  console.error('CLI Error:', err);
  process.exit(1);
});
