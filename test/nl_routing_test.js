/**
 * test/nl_routing_test.js
 * 
 * Verifies that Natural Language Routing (Sticky Intent) correctly identifies 
 * system commands and extracts parameters without falling back to LLM/Web Search.
 */
'use strict';

// Set dummy env vars to prevent DB initialization errors
process.env.TURSO_URL = 'libsql://dummy.turso.io';
process.env.TURSO_AUTH_TOKEN = 'dummy';

const nlRouter = require('../src/handlers/nlRouter');

const testCases = [
  // Reminders
  {
    text: 'Dodaj przypomnienie: jutro o 19:00 karmienie ryb',
    expected: { intent: 'remind', params: { when: 'jutro o 19:00', text: 'karmienie ryb' } }
  },
  {
    text: 'przypomnij o 19:00 ryby',
    expected: { intent: 'remind', params: { when: '19:00', text: 'ryby' } }
  },
  {
    text: 'Dodaj przypomnienie jutro ryby',
    expected: { intent: 'remind', params: { when: 'jutro', text: 'ryby' } }
  },
  {
    text: 'remind me at 5pm to call mom',
    expected: { intent: 'remind', params: { when: '5pm', text: 'call mom' } }
  },

  // Todos
  {
    text: 'Dodaj zadanie: Wyczyścić ekspres',
    expected: { intent: 'todo_add', params: { task: 'Wyczyścić ekspres' } }
  },
  {
    text: 'nowe zadanie: sprzedać auto',
    expected: { intent: 'todo_add', params: { task: 'sprzedać auto' } }
  },
  {
    text: 'add todo: buy milk',
    expected: { intent: 'todo_add', params: { task: 'buy milk' } }
  },

  // Notes
  {
    text: 'Dodaj notatkę: Projekt X to priorytet',
    expected: { intent: 'note_add', params: { note: 'Projekt X to priorytet' } }
  },
  {
    text: 'zapisz notatkę kup prezent',
    expected: { intent: 'note_add', params: { note: 'kup prezent' } }
  },

  // Memory
  {
    text: 'Zapamiętaj że szukam pracy jako Java Developer',
    expected: { intent: 'remember', params: { fact: 'szukam pracy jako Java Developer' } }
  },
  {
    text: 'remember that I like coffee',
    expected: { intent: 'remember', params: { fact: 'I like coffee' } }
  },

  // Briefing
  {
    text: 'włącz briefing',
    expected: { intent: 'briefing_on' }
  },
  {
    text: 'odpal briefing',
    expected: { intent: 'briefing_run_now', params: { type: 'morning' } }
  },
  {
    text: 'odpal wieczorny briefing',
    expected: { intent: 'briefing_run_now', params: { type: 'evening' } }
  },

  // System
  {
    text: 'wyczyść historię',
    expected: { intent: 'clear_history' }
  },
  {
    text: 'zapomnij wszystko',
    expected: { intent: 'forget_all' }
  },
  {
    text: 'aktualizuj bota',
    expected: { intent: 'system_update' }
  },

  // Fallbacks (Should NOT match bot_command immediately or should match correctly)
  {
    text: 'Co tam u Ciebie?',
    expectedType: 'chat'
  },
  {
    text: 'Jaka jest dzisiaj pogoda w Berlinie?',
    expectedType: 'web_search'
  }
];

async function runTests() {
  console.log('🧪 Starting NL Routing Tests...\n');
  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    // We use the sync precheck directly to avoid LLM calls
    const result = nlRouter.precheck(tc.text);
    
    let isOk = false;
    if (tc.expectedType) {
      // For fallbacks, we expect precheck to return null (so it falls through to LLM/Semantic)
      // or to have a different type eventually.
      isOk = (result === null && tc.expectedType !== 'bot_command') || (result?.type === tc.expectedType);
    } else {
      isOk = result?.type === 'bot_command' && 
             result.intent === tc.expected.intent &&
             (!tc.expected.params || JSON.stringify(result.params) === JSON.stringify(tc.expected.params));
    }

    if (isOk) {
      console.log(`✅ PASS: "${tc.text}"`);
      passed++;
    } else {
      console.log(`❌ FAIL: "${tc.text}"`);
      console.log(`   Expected: ${JSON.stringify(tc.expected || tc.expectedType)}`);
      console.log(`   Actual:   ${JSON.stringify(result)}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
