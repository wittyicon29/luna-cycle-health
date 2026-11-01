"""Bring the configured database (DATABASE_URL) to the current schema.

Usage: python -m scripts.migrate [--stamp-existing] [--debug]   (or python scripts/migrate.py)
Exit codes: 0 success, 1 refused or failed.
Unexpected errors print only their class name (driver messages can contain hosts or
credentials); set MIGRATE_DEBUG=1 or pass --debug to log the full traceback.
"""
import argparse
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logger = logging.getLogger("migrate")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--stamp-existing",
        action="store_true",
        help="mark an existing unversioned database (built by create_all) as being at head",
    )
    parser.add_argument("--debug", action="store_true", help="log tracebacks (same as MIGRATE_DEBUG=1)")
    args = parser.parse_args(argv)
    debug = args.debug or os.environ.get("MIGRATE_DEBUG") == "1"
    logging.basicConfig(
        level=logging.DEBUG if debug else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )
    try:
        # Imported here so configuration and import errors go through the same redaction.
        from app.db_migrate import MigrationError, migrate

        try:
            result = migrate(stamp_existing=args.stamp_existing)
        except MigrationError as exc:
            print(f"migrate: {exc}", file=sys.stderr)
            return 1
    except Exception as exc:
        logger.debug("migrate failed", exc_info=True)
        print(f"migrate: failed ({type(exc).__name__}); set MIGRATE_DEBUG=1 for details", file=sys.stderr)
        return 1
    print(f"migrate: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
