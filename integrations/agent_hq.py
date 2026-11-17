"""Lapor aktivitas bot ke Agent HQ. Salin file ini ke proyek bot kamu.

    from agent_hq import report

    report("thinking", "memanggil Grok API")        # sebelum request ke Grok
    report("running", "menjalankan tool: cari_cuaca") # saat bot mengeksekusi tool
    report("reading", "membaca pesan masuk")
    report("waiting", "butuh konfirmasi admin")
    report("error", "429 Too Many Requests")
    report("idle")                                    # selesai, menunggu pesan berikutnya
    report("offline")                                 # bot berhenti: hilang dari dashboard

Status yang valid: coding, running, reading, waiting, thinking, idle, error, offline.
Gagal lapor tidak pernah mengganggu bot (error ditelan, timeout 1 detik).
"""
import json
import os
import threading
import urllib.request

URL = os.environ.get("AGENT_HQ_URL", "http://127.0.0.1:5173/api/events")
AGENT = os.environ.get("AGENT_HQ_NAME", "Grok")  # nama karakter di dashboard
DEFAULTS = {"source": "grok", "model": os.environ.get("AGENT_HQ_MODEL", "grok-4")}


def _send(payload):
    try:
        req = urllib.request.Request(URL, json.dumps(payload).encode(), {"content-type": "application/json"})
        urllib.request.urlopen(req, timeout=1).close()
    except Exception:
        pass


def report(status, task=None, *, agent=None, tool=None, tokens=None, project=None, model=None):
    payload = {**DEFAULTS, "agent": agent or AGENT, "status": status}
    for k, v in (("task", task), ("tool", tool), ("tokens", tokens), ("project", project), ("model", model)):
        if v is not None:
            payload[k] = v
    threading.Thread(target=_send, args=(payload,), daemon=True).start()
