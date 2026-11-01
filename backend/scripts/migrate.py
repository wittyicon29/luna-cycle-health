"""Bring the configured database (DATABASE_URL) to the current schema.

Usage: python -m scripts.migrate [--stamp-existing]   (or python scripts/migrate.py)
Exit codes: 0 success, 1 refused or failed.
"""
import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db_migrate import MigrationError, migrate  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--stamp-existing",
        action="store_true",
        help="mark an existing unversioned database (built by create_all) as being at head",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    try:
        result = migrate(stamp_existing=args.stamp_existing)
    except MigrationError as exc:
        print(f"migrate: {exc}", file=sys.stderr)
        return 1
    print(f"migrate: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
