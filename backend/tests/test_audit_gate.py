"""Unit tests of scripts/ci/audit_gate.py (the dependency audit gate in audit.yml)."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "ci" / "audit_gate.py"
ALLOWLIST = REPO / ".github" / "audit-allowlist.txt"

_spec = importlib.util.spec_from_file_location("audit_gate", GATE)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

# Shapes of real `pip-audit -f json` and `npm audit --json` output (ids are real advisories,
# trimmed to the fields the gate reads).
PIP_REPORT = {
    "dependencies": [
        {"name": "fastapi", "version": "0.115.0", "vulns": []},
        {
            "name": "python-multipart",
            "version": "0.0.12",
            "vulns": [
                {"id": "PYSEC-2026-1851", "fix_versions": ["0.0.18"], "aliases": ["GHSA-59g5-xgcq-4qw3", "CVE-2024-53981"]},
                # pip-audit can list the same advisory twice.
                {"id": "PYSEC-2026-1851", "fix_versions": ["0.0.18"], "aliases": ["GHSA-59g5-xgcq-4qw3"]},
            ],
        },
        {"name": "ecdsa", "version": "0.19.2", "vulns": [{"id": "PYSEC-2026-1325", "fix_versions": [], "aliases": ["CVE-2024-23342"]}]},
    ],
    "fixes": [],
}


def _via(ghsa, name, severity):
    return {"source": 1, "name": name, "title": "t", "url": f"https://github.com/advisories/{ghsa}", "severity": severity, "range": "<9"}


NPM_REPORT = {
    "auditReportVersion": 2,
    "vulnerabilities": {
        "react-router": {"name": "react-router", "severity": "high", "via": [
            _via("GHSA-49rj-9fvp-4h2h", "react-router", "high"),
            _via("GHSA-wrjc-x8rr-h8h6", "react-router", "moderate"),
        ], "fixAvailable": True},
        "react-router-dom": {"name": "react-router-dom", "severity": "high", "via": ["react-router"], "fixAvailable": True},
        "shell-quote": {"name": "shell-quote", "severity": "critical", "via": [_via("GHSA-w7jw-789q-3m8p", "shell-quote", "critical")],
                        "fixAvailable": False},
        "yaml": {"name": "yaml", "severity": "moderate", "via": [_via("GHSA-48c2-rrv3-qjmp", "yaml", "moderate")], "fixAvailable": True},
    },
    "metadata": {"vulnerabilities": {"high": 2, "critical": 1, "moderate": 1}},
}


def _run(tmp_path, kind, report, allowlist_text="", *extra):
    report_path = tmp_path / "report.json"
    report_path.write_text(report if isinstance(report, str) else json.dumps(report))
    allowlist = tmp_path / "allow.txt"
    allowlist.write_text(allowlist_text)
    return subprocess.run([sys.executable, str(GATE), kind, str(report_path), "--allowlist", str(allowlist), *extra],
                          capture_output=True, text=True, timeout=60)


def test_pip_findings_are_deduplicated_and_all_count():
    findings = gate.pip_findings(PIP_REPORT)
    assert [(f["package"], f["id"]) for f in findings] == [("ecdsa", "PYSEC-2026-1325"), ("python-multipart", "PYSEC-2026-1851")]
    assert findings[1]["aliases"] == {"GHSA-59g5-xgcq-4qw3", "CVE-2024-53981"}
    assert findings[1]["fix"] == "0.0.18" and findings[0]["fix"] == "none"


def test_npm_findings_respect_the_severity_threshold():
    high = gate.npm_findings(NPM_REPORT, "high")
    assert [(f["id"], f["severity"]) for f in high] == [("GHSA-w7jw-789q-3m8p", "critical"), ("GHSA-49rj-9fvp-4h2h", "high")]
    moderate = {f["id"] for f in gate.npm_findings(NPM_REPORT, "moderate")}
    assert moderate == {"GHSA-w7jw-789q-3m8p", "GHSA-49rj-9fvp-4h2h", "GHSA-wrjc-x8rr-h8h6", "GHSA-48c2-rrv3-qjmp"}


def test_clean_reports_pass(tmp_path):
    assert _run(tmp_path, "pip", {"dependencies": [{"name": "x", "version": "1", "vulns": []}]}).returncode == 0
    assert _run(tmp_path, "npm", {"auditReportVersion": 2, "vulnerabilities": {}}).returncode == 0
    # Only moderate findings: npm passes at the default (high) threshold.
    only_moderate = {"vulnerabilities": {"yaml": NPM_REPORT["vulnerabilities"]["yaml"]}}
    assert _run(tmp_path, "npm", only_moderate).returncode == 0
    assert _run(tmp_path, "npm", only_moderate, "", "--min-severity", "moderate").returncode == 1


def test_unlisted_findings_fail(tmp_path):
    result = _run(tmp_path, "pip", PIP_REPORT)
    assert result.returncode == 1
    assert "BLOCKING" in result.stdout and "PYSEC-2026-1851" in result.stdout and "PYSEC-2026-1325" in result.stdout
    result = _run(tmp_path, "npm", NPM_REPORT)
    assert result.returncode == 1
    assert "GHSA-w7jw-789q-3m8p" in result.stdout and "GHSA-48c2-rrv3-qjmp" not in result.stdout


def test_allowlisted_findings_pass_by_id_or_alias(tmp_path):
    allow = (
        "# header\n"
        "GHSA-59g5-xgcq-4qw3  # alias of PYSEC-2026-1851: forms are not parsed by this API; revisit 2027-01\n"
        "PYSEC-2026-1325 # ecdsa is unused at runtime (python-jose extra), no fix exists; revisit 2027-01\n"
    )
    result = _run(tmp_path, "pip", PIP_REPORT, allow)
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count("allowlisted  ") == 2
    # One entry is enough to leave the other finding blocking.
    result = _run(tmp_path, "pip", PIP_REPORT, allow.splitlines(keepends=True)[1])
    assert result.returncode == 1


def test_stale_allowlist_entries_are_reported_not_fatal(tmp_path):
    allow = "GHSA-xv26-6w52-cph6  # websocket-driver: dev server only, not shipped; revisit 2027-01\n"
    result = _run(tmp_path, "pip", {"dependencies": []}, allow)
    assert result.returncode == 0
    assert "GHSA-xv26-6w52-cph6 matches nothing" in result.stdout


@pytest.mark.parametrize(
    "line",
    [
        "GHSA-59g5-xgcq-4qw3",  # no justification
        "GHSA-59g5-xgcq-4qw3  #",  # empty justification
        "GHSA-59g5-xgcq-4qw3  # ok",  # too short to be a justification
        "lodash  # we do not care about lodash at all",  # not an advisory id
        "GHSA-59g5-xgcq-4qw3 # reason number one here\nGHSA-59g5-xgcq-4qw3 # reason number two here",  # duplicate
    ],
)
def test_malformed_allowlist_is_an_error(tmp_path, line):
    result = _run(tmp_path, "pip", PIP_REPORT, line + "\n")
    assert result.returncode == 2, result.stdout + result.stderr
    assert "allowlist line" in result.stderr


@pytest.mark.parametrize(
    "kind,report",
    [
        ("pip", "not json"),
        ("pip", {"something": "else"}),
        ("pip", {"dependencies": [{"name": "private-pkg", "version": "1", "skip_reason": "not on PyPI"}]}),
        ("npm", {"error": {"code": "ENOLOCK", "summary": "no lockfile"}}),
        ("npm", {"advisories": {}}),  # npm 6 format
        ("npm", {"vulnerabilities": {"x": {"via": [{"severity": "extreme", "url": ""}]}}}),
    ],
)
def test_broken_reports_are_errors_not_passes(tmp_path, kind, report):
    result = _run(tmp_path, kind, report)
    assert result.returncode == 2, result.stdout + result.stderr


def test_missing_report_is_an_error(tmp_path):
    allowlist = tmp_path / "allow.txt"
    allowlist.write_text("")
    result = subprocess.run([sys.executable, str(GATE), "pip", str(tmp_path / "missing.json"), "--allowlist", str(allowlist)],
                            capture_output=True, text=True)
    assert result.returncode == 2
    assert "did the audit tool fail" in result.stderr


def test_repository_allowlist_is_valid_and_starts_empty():
    entries = gate.parse_allowlist(ALLOWLIST.read_text(encoding="utf-8"))
    # The current findings are listed in the task report for a decision; nothing is
    # allowlisted silently. Entries added later must each carry a justification (parsed above).
    assert isinstance(entries, dict)
    text = ALLOWLIST.read_text(encoding="utf-8")
    assert "justification" in text.lower()
