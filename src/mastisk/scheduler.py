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
