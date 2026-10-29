import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEBUG_PORT = 9260 + Math.floor(Math.random() * 30);
const SNAPS_DIR = path.resolve('snaps');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      if (res.ok) {
        const data = await res.json();
        const page = Array.isArray(data) ? data.find(t => t.type === 'page') : null;
        if (page && page.webSocketDebuggerUrl) {
          return page.webSocketDebuggerUrl;
        }
      }
    } catch (e) {}
    await sleep(300);
  }
  throw new Error('Failed to connect to Chrome debugging port');
}

async function run() {
  console.log(`📸 Initializing Headless Chrome for Screen Audit on port ${DEBUG_PORT}...`);
  const chrome = spawn(CHROME_PATH, [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--window-size=1440,900',
    'http://127.0.0.1:8000'
  ]);

  try {
    const wsUrl = await getWsUrl();
    console.log('🔗 Connected to CDP at:', wsUrl);

    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = rej;
    });

    let id = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg.result || msg.error);
        callbacks.delete(msg.id);
      }
    };

    function send(method, params = {}, timeoutMs = 12000) {
      return new Promise((resolve) => {
        const msgId = id++;
        const timer = setTimeout(() => {
          callbacks.delete(msgId);
          resolve({ error: 'timeout' });
        }, timeoutMs);
        callbacks.set(msgId, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await send('Runtime.enable');
    await send('Page.enable');
    await send('DOM.enable');

    console.log('⏳ Waiting for app initial mount...');
    await sleep(3000);

    async function takeSnap(filename, description) {
      const snap = await send('Page.captureScreenshot', { format: 'png' });
      if (snap?.data) {
        const filePath = path.join(SNAPS_DIR, filename);
        fs.writeFileSync(filePath, Buffer.from(snap.data, 'base64'));
        console.log(`📸 [SAVED] ${filename} - ${description}`);
      } else {
        console.error(`❌ [FAILED] could not capture ${filename}`);
      }
    }

    // 1. Snapshot: Main Infinite Grid View with Catalog & Telemetry
    await takeSnap('01_infinite_grid_active.png', 'Studio Infinite Grid (100k rows cache, Data Weather sidebar, Telemetry footer)');

    // 2. Snapshot: Perspective Pivot Table View
    console.log('Navigating to Perspective Pivot...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Perspective Pivot'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1500);
    await takeSnap('02_perspective_pivot_table.png', 'Perspective Pivot Matrix Table (multi-column grouping and aggregation)');

    // 3. Snapshot: Perspective Bar Chart Visualization
    console.log('Toggling Perspective Bar Chart...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = document.querySelector('button[title*="Bar"]');
        if (btn) btn.click();
      })()`
    });
    await sleep(800);
    await takeSnap('03_perspective_pivot_chart.png', 'Perspective GPU-style Grouped Bar Chart');

    // 4. Snapshot: SQL Playground
    console.log('Navigating to SQL Playground...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('SQL Playground'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1000);
    // Click Run Query
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Run Query'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1500);
    await takeSnap('04_sql_playground.png', 'SQL Playground with Query Editor & Executed Results');

    // 5. Snapshot: X-Ray Drawer
    console.log('Opening X-Ray Plan Drawer...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('X-Ray Plan'));
        if (btn) btn.click();
      })()`
    });
    await sleep(800);
    await takeSnap('05_xray_plan_drawer.png', 'X-Ray Drawer with Query Plan & Hardware Waterfall Timing');

    // Close X-Ray drawer for next shots
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('X-Ray Plan'));
        if (btn) btn.click();
      })()`
    });
    await sleep(400);

    // 6. Snapshot: Arena Race Mode
    console.log('Switching to Arena Race Mode...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Arena Race Mode'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1000);
    // Fire race
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('FIRE SYNCHRONIZED RACE'));
        if (btn) btn.click();
      })()`
    });
    await sleep(2500);
    await takeSnap('06_arena_race_winner.png', 'Arena Dual-Engine Synchronized Benchmark with Winner Banner');

    // Switch back to Studio
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Studio Workbench'));
        if (btn) btn.click();
      })()`
    });
    await sleep(800);

    // 7. Snapshot: Open Torture Suite Modal & Trigger background run
    console.log('Opening Torture Suite Modal...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Torture Suite'));
        if (btn) btn.click();
      })()`
    });
    await sleep(800);

    // Click Run Torture Suite
    await send('Runtime.evaluate', {
      expression: `(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('Run Torture Suite'));
        if (btn) btn.click();
      })()`
    });
    await sleep(1200);
    await takeSnap('07_torture_suite_progress.png', 'Torture Suite Live Streaming Progress (Progress Bar & Active Step)');

    // Wait for all workloads to finish
    console.log('Waiting for Torture Suite to complete in background...');
    for (let i = 0; i < 40; i++) {
      const check = await send('Runtime.evaluate', {
        expression: `document.body.textContent.includes('Overall Winner:') || document.body.textContent.includes('All workloads completed')`,
        returnByValue: true
      });
      if (check?.result?.value) break;
      await sleep(500);
    }
    await sleep(1000);
    await takeSnap('08_torture_suite_completed.png', 'Torture Suite Completed Scorecard (100% OK with Winner)');

    ws.close();
  } finally {
    chrome.kill();
  }
}

run().catch(err => {
  console.error('Snapshot capture failed:', err);
  process.exit(1);
});
