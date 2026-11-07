"""Re-encrypt every encrypted column under the newest key in ENCRYPTION_KEYS.

Usage: python scripts/rotate_encryption_keys.py [--apply] [--batch-size 200] [--encrypt-legacy]
                                               [--allow-single-key] [--tables a,b]
       (or python -m scripts.rotate_encryption_keys ...)

Procedure: put the new key FIRST in ENCRYPTION_KEYS and keep the old ones after it
(ENCRYPTION_KEYS=new,old), deploy, run this script without --apply (dry run, changes
nothing), then with --apply. Remove the old key only after a later dry run reports
nothing pending.

- Columns are discovered from the models (every EncryptedText / EncryptedJSON column).
- The stored text is read and written with plain SQL, bypassing the column types. Rows the
  newest key already decrypts are skipped, so the run is idempotent and resumable.
- Each value is decrypted, re-encrypted with the newest key and checked (the new token must
  decrypt with the newest key alone to the identical plaintext) before it is written. JSON
  columns are rotated as the stored JSON string, never parsed or re-serialised.
- One transaction per batch (primary-key keyset pagination). With --apply, the first row
  that no configured key decrypts aborts the run and rolls back that batch.
- Rows without the "enc:v1:" prefix are legacy plaintext: reported only, unless
  --encrypt-legacy is given.
- Fewer than two keys (including the development key derived from SECRET_KEY when
  ENCRYPTION_KEYS is empty) means there is nothing to rotate to: the script refuses, and
  with --allow-single-key only reports (it never writes).
- Output is counts per column only, never values, tokens or keys.

Exit codes: 0 success / nothing pending, 1 refused or failed (including any undecryptable
row), 2 dry run found work pending (so automation can detect an unfinished rotation).
"""
import argparse
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Callable, Dict, Iterable, Optional, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import Text, and_, column, select, table, tuple_, update  # noqa: E402

DEFAULT_BATCH_SIZE = 200


class RotationError(Exception):
    """Rotation stopped; the message names the column and never includes a value."""

    def __init__(self, message: str, report: "Report"):
        super().__init__(message)
        self.report = report


@dataclass
class ColumnCounts:
    total: int = 0  # non-empty values scanned (NULL and "" are skipped)
    already_current: int = 0  # readable with the newest key alone
    rotated: int = 0  # re-encrypted (dry run: would be)
    legacy_plaintext: int = 0  # no "enc:v1:" prefix
    encrypted_legacy: int = 0  # legacy rows encrypted (dry run: would be); needs --encrypt-legacy
    undecryptable: int = 0  # no configured key decrypts the row
    changed_during_run: int = 0  # row changed between read and write (left as the app wrote it)

    def add(self, other: "ColumnCounts") -> None:
        for f in fields(self):
            setattr(self, f.name, getattr(self, f.name) + getattr(other, f.name))


@dataclass
class Report:
    apply: bool
    columns: Dict[Tuple[str, str], ColumnCounts] = field(default_factory=dict)

    def totals(self) -> ColumnCounts:
        total = ColumnCounts()
        for counts in self.columns.values():
            total.add(counts)
        return total

    @property
    def pending(self) -> int:
        """Rows a dry run would write (always 0 after --apply)."""
        if self.apply:
            return 0
        totals = self.totals()
        return totals.rotated + totals.encrypted_legacy

    def lines(self) -> Iterable[str]:
        verb = "" if self.apply else "would_"
        for (table_name, column_name), c in self.columns.items():
            yield (
                f"{table_name}.{column_name}: total={c.total} already_current={c.already_current} "
                f"{verb}rotate={c.rotated} legacy_plaintext={c.legacy_plaintext} "
                f"{verb}encrypt_legacy={c.encrypted_legacy} undecryptable={c.undecryptable} "
                f"changed_during_run={c.changed_during_run}"
            )


def rotate_database(
    engine,
    service,
    apply: bool,
    batch_size: int = DEFAULT_BATCH_SIZE,
    encrypt_legacy: bool = False,
    *,
    tables: Optional[Iterable[str]] = None,
    metadata=None,
    after_batch: Optional[Callable] = None,
) -> Report:
    """Rotate (apply=True) or count (apply=False) every encrypted column.

    `service` is an EncryptionService whose first key is the newest. `after_batch(column,
    written)` is called after each committed batch that wrote rows (tests use it to inject
    failures). Raises RotationError (with the partial report) when a row cannot be decrypted
    during --apply or a re-encrypted value fails verification.
    """
    from app.core.encrypted_columns import encrypted_columns

    if batch_size < 1:
        raise ValueError("batch_size must be at least 1")
    if metadata is None:
        from app.core.database import Base

        encrypted = encrypted_columns()
        metadata = Base.metadata
    else:
        encrypted = encrypted_columns(metadata)
    if tables is not None:
        wanted = set(tables)
        unknown = wanted - {c.table for c in encrypted}
        if unknown:
            raise ValueError(f"no encrypted columns in table(s): {', '.join(sorted(unknown))}")
        encrypted = [c for c in encrypted if c.table in wanted]

    report = Report(apply=apply)
    if apply and service.key_count < 2:
        raise RotationError("refusing to write with fewer than two keys configured", report)
    for enc in encrypted:
        counts = report.columns.setdefault((enc.table, enc.column), ColumnCounts())
        _rotate_column(engine, service, enc, metadata, apply, batch_size, encrypt_legacy, counts, report, after_batch)
    return report


def _rotate_column(engine, service, enc, metadata, apply, batch_size, encrypt_legacy, counts, report, after_batch):
    real = metadata.tables[enc.table]
    # Lightweight table: real primary-key types (UUIDs round-trip), plain Text for the value
    # so the stored ciphertext is read and written untouched by EncryptedText/EncryptedJSON.
    pk_cols = [column(name, real.c[name].type) for name in enc.pk_columns]
    value_col = column(enc.column, Text())
    raw = table(enc.table, *pk_cols, value_col)
    pk_key = pk_cols[0] if len(pk_cols) == 1 else tuple_(*pk_cols)

    last = None
    while True:
        batch = ColumnCounts()
        writes = []
        with engine.begin() as conn:  # one transaction per batch; an exception rolls it back
            query = select(*pk_cols, value_col).where(value_col.is_not(None), value_col != "")
            if last is not None:
                query = query.where(pk_key > (last[0] if len(pk_cols) == 1 else tuple_(*last)))
            rows = conn.execute(query.order_by(*pk_cols).limit(batch_size)).all()
            if not rows:
                break
            for row in rows:
                pk, stored = tuple(row[:-1]), row[-1]
                batch.total += 1
                legacy = not service.is_encrypted(stored)
                if legacy:
                    batch.legacy_plaintext += 1
                    if not encrypt_legacy:
                        continue
                    plaintext = stored
                elif service.is_current(stored):
                    batch.already_current += 1
                    continue
                else:
                    try:
                        plaintext = service.decrypt(stored)
                    except ValueError:
                        batch.undecryptable += 1
                        if apply:
                            counts.undecryptable += 1
                            raise RotationError(
                                f"{enc.table}.{enc.column}: a row cannot be decrypted with any configured key; "
                                "aborted, the current batch was rolled back and nothing in it was written "
                                "(add the missing old key to ENCRYPTION_KEYS, after the newest one)",
                                report,
                            ) from None
                        continue
                new = service.encrypt(plaintext)
                if not service.is_current(new) or service.decrypt(new) != plaintext:
                    raise RotationError(
                        f"{enc.table}.{enc.column}: re-encrypted value failed verification; aborted, batch rolled back",
                        report,
                    )
                if legacy:
                    batch.encrypted_legacy += 1
                else:
                    batch.rotated += 1
                writes.append((pk, stored, new, legacy))
            if apply:
                for pk, stored, new, legacy in writes:
                    # Guard on the old value: a row the app rewrote meanwhile is left alone.
                    match = and_(*[c == v for c, v in zip(pk_cols, pk)], value_col == stored)
                    result = conn.execute(update(raw).where(match).values({enc.column: new}))
                    if result.rowcount != 1:
                        batch.changed_during_run += 1
                        if legacy:
                            batch.encrypted_legacy -= 1
                        else:
                            batch.rotated -= 1
            last = tuple(rows[-1][:-1])
        counts.add(batch)  # only after the batch committed
        written = batch.rotated + batch.encrypted_legacy
        if apply and written and after_batch is not None:
            after_batch(enc, written)
        if len(rows) < batch_size:
            break


class _ArgumentError(Exception):
    pass


class _Parser(argparse.ArgumentParser):
    def error(self, message):  # argparse's default exit code 2 would mean "pending"
        raise _ArgumentError(message)


def _parse(argv):
    parser = _Parser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry run, writes nothing)")
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE, help="rows per transaction")
    parser.add_argument("--encrypt-legacy", action="store_true", help="also encrypt legacy plaintext rows")
    parser.add_argument(
        "--allow-single-key", action="store_true", help="with fewer than two keys, report only instead of refusing"
    )
    parser.add_argument("--tables", default="", help="comma-separated table names (default: all)")
    return parser.parse_args(argv)


def _err(message):
    print(f"rotate: {message}", file=sys.stderr)


def main(argv=None, *, engine=None, service=None) -> int:
    try:
        args = _parse(argv)
    except _ArgumentError as exc:
        _err(f"invalid arguments: {exc}")
        return 1
    if args.batch_size < 1:
        _err("--batch-size must be at least 1")
        return 1
    tables = [t.strip() for t in args.tables.split(",") if t.strip()] or None
    try:
        # Imported here so configuration errors go through the same class-name-only redaction.
        if service is None:
            from app.core.config import settings
            from app.core.encryption import EncryptionService

            service = EncryptionService(settings.encryption_key_list)
        if engine is None:
            from app.core.database import engine
        if service.key_count < 2:
            reason = (
                "only one encryption key is configured (ENCRYPTION_KEYS has fewer than two keys, or is empty "
                "and the development key derived from SECRET_KEY is in use): single key, nothing to rotate to"
            )
            if args.apply:
                _err(f"refusing --apply: {reason}")
                return 1
            if not args.allow_single_key:
                _err(f"refusing to run: {reason}; pass --allow-single-key to report counts only")
                return 1
        print(
            f"rotate: {'APPLY' if args.apply else 'dry run (nothing is written; pass --apply)'}; "
            f"{service.key_count} key(s) configured"
        )
        report = rotate_database(
            engine, service, apply=args.apply, batch_size=args.batch_size,
            encrypt_legacy=args.encrypt_legacy, tables=tables,
        )
    except RotationError as exc:
        for line in exc.report.lines():
            print(line)
        _err(str(exc))
        return 1
    except ValueError as exc:
        # Only our own argument checks raise ValueError with a safe message here; anything
        # else (drivers, settings) is reported by class name below.
        if str(exc).startswith("no encrypted columns in table"):
            _err(str(exc))
            return 1
        _err(f"failed ({type(exc).__name__})")
        return 1
    except Exception as exc:
        # Driver messages can contain hosts, credentials or bound values: class name only.
        _err(f"failed ({type(exc).__name__})")
        return 1

    for line in report.lines():
        print(line)
    totals = report.totals()
    if totals.undecryptable:
        _err(f"{totals.undecryptable} row(s) cannot be decrypted with any configured key")
        return 1
    if report.pending:
        print(f"rotate: {report.pending} row(s) pending; run again with --apply")
        return 2
    print(f"rotate: done; {totals.rotated + totals.encrypted_legacy if args.apply else 0} row(s) written")
    return 0


if __name__ == "__main__":
    sys.exit(main())
