"""APScheduler wiring. Thin for now — concrete agents wire in during their step."""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

log = logging.getLogger("mastisk.scheduler")


async def start_scheduler():
    sched = AsyncIOScheduler(timezone="UTC")

    # Agent ticks — each agent's tick_seconds is its cadence.
    # Registered here once agents are implemented; for M1 skeleton we only start the scheduler.
    try:
        from mastisk.agents.scout import Scout
        sched.add_job(Scout().run_once, "interval", seconds=Scout.tick_seconds, id="scout", max_instances=1)
    except Exception as e:
        log.info("scout not scheduled: %s", e)

    try:
        from mastisk.agents.compiler import Compiler
        sched.add_job(Compiler().run_once, "interval", seconds=Compiler.tick_seconds, id="compiler", max_instances=1)
    except Exception as e:
        log.info("compiler not scheduled: %s", e)

    sched.start()
    log.info("scheduler started")
    return sched


async def stop_scheduler(sched) -> None:
    sched.shutdown(wait=False)
