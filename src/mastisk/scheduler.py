"""APScheduler wiring. Thin for now — concrete agents wire in during their step."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler

log = logging.getLogger("mastisk.scheduler")


async def start_scheduler():
    sched = AsyncIOScheduler(timezone="UTC")

    # Reclaim orphaned `running` jobs — if a previous process was killed
    # mid-compile, those rows never transition to done/failed and _pick_job
    # ignores them (only picks `queued`), so they'd be stuck forever.
    _reclaim_orphaned_running()

    # One-shot graph repair on boot: reconnects links the Compiler dropped
    # because sibling articles didn't exist yet. This closes the gap between
    # "articles written before this pass existed" and the first Linter tick
    # (which is ~30s after boot). Pure SQL; no network.
    _graph_repair_once()

    # APScheduler's "interval" trigger fires *after* one interval; passing
    # next_run_time forces the first tick a few seconds after startup so
    # queued jobs drain immediately instead of waiting tick_seconds.
    soon = datetime.now(timezone.utc) + timedelta(seconds=2)

    try:
        from mastisk.agents.scout import Scout
        sched.add_job(
            Scout().run_once, "interval",
            seconds=Scout.tick_seconds, id="scout",
            max_instances=1, next_run_time=soon, coalesce=True,
        )
    except Exception as e:
        log.info("scout not scheduled: %s", e)

    try:
        from mastisk.agents.compiler import Compiler
        sched.add_job(
            Compiler().run_once, "interval",
            seconds=Compiler.tick_seconds, id="compiler",
            max_instances=1, next_run_time=soon, coalesce=True,
        )
    except Exception as e:
        log.info("compiler not scheduled: %s", e)

    try:
        from mastisk.agents.notetaker import Notetaker
        # 30s tick per spec §4 + §10. First run 5s after boot so any files
        # dropped into the vault between process restarts start the two-tick
        # stability clock promptly (first tick = register, second tick = classify).
        sched.add_job(
            Notetaker().run_once, "interval",
            seconds=Notetaker.tick_seconds, id="notetaker",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=5),
            coalesce=True,
        )
    except Exception as e:
        log.info("notetaker not scheduled: %s", e)

    try:
        from mastisk.agents.escalator import Escalator
        # 60s tick per spec §4 + §10. First run 10s after boot so any evaluate
        # jobs queued by the Notetaker right before a restart drain promptly.
        sched.add_job(
            Escalator().run_once, "interval",
            seconds=Escalator.tick_seconds, id="escalator",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=10),
            coalesce=True,
        )
    except Exception as e:
        log.info("escalator not scheduled: %s", e)

    try:
        from mastisk.agents.vault_integrity import vault_integrity_scan
        # Tombstones notes whose vault file was deleted externally (Obsidian,
        # Finder, iOS Files). 5min tick is plenty — this is slow drift, not a
        # hot path. First run 30s after boot.
        sched.add_job(
            vault_integrity_scan, "interval",
            minutes=5, id="vault_integrity",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            coalesce=True,
        )
        log.info("scheduler: vault_integrity registered (5min tick)")
    except Exception as e:
        log.warning("scheduler: vault_integrity registration failed: %s", e)

    try:
        from mastisk.agents.linter import Linter
        # Linter runs slightly after Scout/Compiler so it sees fresh articles
        # on the same boot without racing them.
        sched.add_job(
            Linter().run_once, "interval",
            seconds=Linter.tick_seconds, id="linter",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            coalesce=True,
        )
    except Exception as e:
        log.info("linter not scheduled: %s", e)

    try:
        from mastisk.agents.artifact_agent import ArtifactAgent
        # ArtifactAgent is job-driven (regenerate endpoint enqueues work).
        # Fire 30s after boot so any pending regenerate jobs from before a
        # restart pick up promptly.
        sched.add_job(
            ArtifactAgent().run_once, "interval",
            seconds=ArtifactAgent.tick_seconds, id="artifact-agent",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            coalesce=True,
        )
    except Exception as e:
        log.info("artifact-agent not scheduled: %s", e)

    try:
        from mastisk.agents.listener import Listener
        # Listener handles YouTube + podcast transcription jobs. Like Compiler,
        # it's job-driven (CLI / POST /api/listen enqueues work). First tick
        # 30s after boot so any pending transcribe jobs from a crash resume.
        sched.add_job(
            Listener().run_once, "interval",
            seconds=Listener.tick_seconds, id="listener",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=30),
            coalesce=True,
        )
    except Exception as e:
        log.info("listener not scheduled: %s", e)

    try:
        from mastisk.agents.synthesizer import Synthesizer
        # Synthesizer drains any queued synthesizer jobs each tick, then
        # *optionally* attempts one spontaneous cross-article synthesis.
        # First run 60s after boot so the corpus has had a moment to settle
        # after whatever the Compiler did on startup — we don't want to
        # synthesize on half-populated clusters.
        sched.add_job(
            Synthesizer().run_once, "interval",
            seconds=Synthesizer.tick_seconds, id="synthesizer",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=60),
            coalesce=True,
        )
    except Exception as e:
        log.info("synthesizer not scheduled: %s", e)

    try:
        from mastisk.agents.roundtable import Roundtable
        # Roundtable is purely job-driven (POST /api/roundtables enqueues a
        # fan_out job). 10s tick keeps latency low for a user who just clicked
        # the button; first run 5s after boot so any jobs queued before a
        # restart drain promptly.
        sched.add_job(
            Roundtable().run_once, "interval",
            seconds=Roundtable.tick_seconds, id="roundtable",
            max_instances=1,
            next_run_time=datetime.now(timezone.utc) + timedelta(seconds=5),
            coalesce=True,
        )
        log.info("scheduler: roundtable registered (10s tick)")
    except Exception as e:
        log.warning("scheduler: roundtable registration failed: %s", e)

    sched.start()
    log.info("scheduler started")
    return sched


async def stop_scheduler(sched) -> None:
    sched.shutdown(wait=False)


def _reclaim_orphaned_running() -> None:
    from mastisk.db.queries import connect
    with connect() as conn:
        cur = conn.execute(
            "UPDATE jobs SET status='queued', started_at=NULL WHERE status='running'"
        )
        if cur.rowcount:
            log.info("reclaimed %s orphaned running job(s)", cur.rowcount)


def _graph_repair_once() -> None:
    """Run Linter's graph-repair pass once on scheduler startup. Reconnects
    any ``<span class="link" data-target>`` references whose target existed
    but wasn't in the ``links`` table (e.g. articles written by the Compiler
    before the repair pass existed). Logs the count; no feed row is emitted.
    """
    try:
        from mastisk.agents.linter import Linter
        n = Linter.repair_graph()
        if n:
            log.info("boot graph-repair: inserted %s link(s)", n)
    except Exception as e:
        log.warning("boot graph-repair skipped: %s", e)
