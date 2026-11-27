// Lapor aktivitas bot ke Agent HQ (Node 18+). Salin file ini ke proyek bot kamu.
//
//   import { report } from './agent-hq.mjs';
//   report('thinking', 'memanggil Grok API');
//   report('running', 'menjalankan tool: cari_cuaca');
//   report('idle');      // selesai, menunggu pesan berikutnya
//   report('offline');   // bot berhenti: hilang dari dashboard
//
// Status yang valid: coding, running, reading, waiting, thinking, idle, error, offline.
// Gagal lapor tidak pernah mengganggu bot.
const URL = process.env.AGENT_HQ_URL || 'http://127.0.0.1:5190/api/events';
const AGENT = process.env.AGENT_HQ_NAME || 'Grok';
const MODEL = process.env.AGENT_HQ_MODEL || 'grok-4';

export function report(status, task, extra = {}) {
  const body = JSON.stringify({ source: 'grok', model: MODEL, agent: AGENT, status, ...(task ? { task } : {}), ...extra });
  fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal: AbortSignal.timeout(1000) }).catch(() => {});
}
