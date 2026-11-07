#!/usr/bin/env python3
"""Dependency audit gate: fail on known vulnerabilities that are not allowlisted.

    python scripts/ci/audit_gate.py pip REPORT.json [--allowlist FILE]
    python scripts/ci/audit_gate.py npm REPORT.json [--allowlist FILE] [--min-severity high]

REPORT.json is the output of `pip-audit -r backend/requirements.txt -f json` or of
`npm audit --omit=dev --json`. pip-audit reports carry no severity, so every pip finding
counts; npm advisories count from --min-severity up (default high, like
`npm audit --audit-level=high`).

The allowlist (default .github/audit-allowlist.txt) has one advisory id per line followed
by `# justification`; the justification is mandatory. An id matches a finding when it is
the advisory id or one of its aliases (CVE/GHSA/PYSEC). Only ids are printed, never
anything from the environment.

Exit codes: 0 no unallowlisted finding, 1 unallowlisted findings, 2 usage error, unreadable
or malformed report or allowlist.
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_ALLOWLIST = REPO / ".github" / "audit-allowlist.txt"
SEVERITIES = ["info", "low", "moderate", "high", "critical"]
ID_PATTERN = re.compile(r"^(GHSA(-[23456789cfghjmpqrvwx]{4}){3}|PYSEC-\d{4}-\d+|CVE-\d{4}-\d{4,}|OSV-[\w-]+)$")


class GateError(Exception):
    """Malformed input: exit 2."""


def parse_allowlist(text):
    """Allowlist text -> {id: justification}. Raises GateError on a malformed line."""
    entries = {}
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        advisory, sep, justification = line.partition("#")
        advisory = advisory.strip()
        justification = justification.strip()
        if not ID_PATTERN.match(advisory):
            raise GateError(f"allowlist line {number}: not an advisory id: {advisory[:40]!r}")
        if not sep or len(justification) < 10:
            raise GateError(f"allowlist line {number}: {advisory} needs a justification comment (# why, revisit when)")
        if advisory in entries:
            raise GateError(f"allowlist line {number}: {advisory} is listed twice")
        entries[advisory] = justification
    return entries


def pip_findings(report):
    """pip-audit JSON -> sorted unique findings [{id, aliases, package, version, severity, fix}]."""
    if not isinstance(report, dict) or not isinstance(report.get("dependencies"), list):
        raise GateError("not a pip-audit JSON report (no 'dependencies' list)")
    found = {}
    for dep in report["dependencies"]:
        if not isinstance(dep, dict):
            raise GateError("pip-audit report: malformed dependency entry")
        if "skip_reason" in dep and not dep.get("vulns"):
            # A dependency pip-audit could not check must not pass silently.
            raise GateError(f"pip-audit skipped {dep.get('name')}: {dep['skip_reason']}")
        for vuln in dep.get("vulns", []):
            key = (dep.get("name"), vuln.get("id"))
            entry = found.setdefault(
                key,
                {
                    "id": vuln.get("id"),
                    "aliases": set(),
                    "package": dep.get("name"),
                    "version": dep.get("version"),
                    "severity": "unrated",
                    "fix": ", ".join(vuln.get("fix_versions") or []) or "none",
                },
            )
            entry["aliases"].update(vuln.get("aliases") or [])
    return sorted(found.values(), key=lambda f: (f["package"] or "", f["id"] or ""))


def npm_findings(report, min_severity):
    """npm audit --json (lockfile v2/v3 format) -> findings at or above min_severity."""
    if not isinstance(report, dict):
        raise GateError("not an npm audit JSON report")
    if "error" in report:
        error = report["error"]
        code = error.get("code") if isinstance(error, dict) else None
        raise GateError(f"npm audit reported an error ({code or 'unknown'})")
    vulnerabilities = report.get("vulnerabilities")
    if not isinstance(vulnerabilities, dict):
        raise GateError("not an npm audit JSON report (no 'vulnerabilities' object; npm 7+ is needed)")
    threshold = SEVERITIES.index(min_severity)
    found = {}
    for name, vuln in vulnerabilities.items():
        for via in vuln.get("via", []):
            if not isinstance(via, dict):
                continue  # a package name: the advisory is listed under that package
            severity = via.get("severity", "")
            if severity not in SEVERITIES:
                raise GateError(f"npm audit report: unknown severity {severity!r}")
            if SEVERITIES.index(severity) < threshold:
                continue
            match = re.search(r"GHSA(-[0-9a-z]{4}){3}", via.get("url", ""))
            advisory = match.group(0) if match else f"npm-{via.get('source')}"
            found.setdefault(
                advisory,
                {
                    "id": advisory,
                    "aliases": set(),
                    "package": via.get("name", name),
                    "version": via.get("range", "?"),
                    "severity": severity,
                    "fix": "available" if vuln.get("fixAvailable") else "none",
                },
            )
    order = {s: i for i, s in enumerate(reversed(SEVERITIES))}
    return sorted(found.values(), key=lambda f: (order[f["severity"]], f["package"], f["id"]))


def apply_allowlist(findings, allowlist):
    """-> (blocking findings, allowlisted findings, unused allowlist ids)."""
    used = set()
    blocking, allowed = [], []
    for finding in findings:
        ids = {finding["id"], *finding["aliases"]}
        hit = sorted(ids & set(allowlist))
        if hit:
            used.update(hit)
            allowed.append(finding)
        else:
            blocking.append(finding)
    return blocking, allowed, sorted(set(allowlist) - used)


def _describe(finding):
    aliases = ", ".join(sorted(finding["aliases"]))
    return (
        f"{finding['id']:<22} {finding['severity']:<9} {finding['package']} {finding['version']}"
        f" (fix: {finding['fix']}){'  aka ' + aliases if aliases else ''}"
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Fail on known vulnerabilities that are not allowlisted.")
    parser.add_argument("kind", choices=["pip", "npm"])
    parser.add_argument("report", type=Path)
    parser.add_argument("--allowlist", type=Path, default=DEFAULT_ALLOWLIST)
    parser.add_argument("--min-severity", choices=SEVERITIES, default="high", help="npm only (default: high)")
    args = parser.parse_args(argv)

    try:
        try:
            report = json.loads(args.report.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise GateError(f"report not found: {args.report.name} (did the audit tool fail?)")
        except json.JSONDecodeError:
            raise GateError(f"report is not JSON: {args.report.name} (did the audit tool fail?)")
        try:
            allowlist = parse_allowlist(args.allowlist.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise GateError(f"allowlist not found: {args.allowlist}")
        if args.kind == "pip":
            findings = pip_findings(report)
        else:
            findings = npm_findings(report, args.min_severity)
    except GateError as exc:
        print(f"audit-gate: error: {exc}", file=sys.stderr)
        return 2

    blocking, allowed, unused = apply_allowlist(findings, allowlist)
    scope = "all severities" if args.kind == "pip" else f"severity >= {args.min_severity}"
    print(f"audit-gate ({args.kind}, {scope}): {len(findings)} finding(s), {len(allowed)} allowlisted, {len(blocking)} blocking")
    for finding in allowed:
        print(f"  allowlisted  {_describe(finding)}")
    for finding in blocking:
        print(f"  BLOCKING     {_describe(finding)}")
    for advisory in unused:
        print(f"  note: allowlist entry {advisory} matches nothing in this {args.kind} report (remove it if it is fixed)")
    if blocking:
        print(
            "audit-gate: FAIL: upgrade the affected packages, or add the advisory id with a justification to "
            ".github/audit-allowlist.txt",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
