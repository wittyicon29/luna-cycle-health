from datetime import date, timedelta

from sqlalchemy import text

from app.core.security import create_access_token
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.models import DailyLog, Medication

URL = "/api/v1/logs/"


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def _put(client, user, day, body):
    return client.put(f"{URL}{day}", json=body, headers=_h(user))


def _med(db, user, name="Iron"):
    med = Medication(user_id=user.id, name=name)
    db.add(med)
    db.commit()
    db.refresh(med)
    return str(med.id)


def test_requires_authentication(client):
    assert client.get(URL + "?from=2026-10-01&to=2026-10-31").status_code == 403
    assert client.put(URL + "2026-10-01", json={"mood": 3}).status_code == 403


def test_upsert_returns_and_lists_the_entry(client, db, make_user):
    user = make_user()
    med = _med(db, user)
    body = {"mood": 4, "symptoms": ["cramps", "cramps", "headache"], "flow": "spotting", "sleep_hours": 7.5,
            "water_glasses": 6, "medications_taken": [med, med], "note": "  felt ok  "}
    first = _put(client, user, "2026-10-20", body)
    assert first.status_code == 200
    stored = first.json()
    assert stored["date"] == "2026-10-20" and stored["mood"] == 4
    assert stored["symptoms"] == ["cramps", "headache"]
    assert stored["medications_taken"] == [med] and stored["note"] == "felt ok"
    assert stored["flow"] == "spotting" and stored["sleep_hours"] == 7.5 and stored["water_glasses"] == 6

    second = _put(client, user, "2026-10-20", {"mood": 2})
    assert second.status_code == 200 and second.json()["mood"] == 2 and second.json()["symptoms"] == []
    rows = client.get(URL + "?from=2026-10-01&to=2026-10-31", headers=_h(user)).json()
    assert len(rows) == 1 and rows[0]["mood"] == 2
    assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 1


def test_empty_entry_deletes_and_never_creates(client, db, make_user):
    user = make_user()
    empty = _put(client, user, "2026-10-20", {})
    assert empty.json() == {"date": "2026-10-20", "deleted": True}
    assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 0
    _put(client, user, "2026-10-20", {"mood": 3})
    for blank in [{}, {"symptoms": [], "note": "   ", "medications_taken": []}, {"mood": None, "flow": None}]:
        _put(client, user, "2026-10-20", {"mood": 3})
        assert _put(client, user, "2026-10-20", blank).json()["deleted"] is True
        assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 0


def test_zero_is_a_real_value(client, make_user):
    user = make_user()
    stored = _put(client, user, "2026-10-20", {"sleep_hours": 0, "water_glasses": 0}).json()
    assert stored["sleep_hours"] == 0 and stored["water_glasses"] == 0


def test_validation(client, db, make_user):
    user = make_user()
    bad_bodies = [
        {"mood": 0}, {"mood": 6}, {"mood": "ok"},
        {"symptoms": ["nope"]}, {"symptoms": ["cramps"] * 11 + ["bloating"]},
        {"flow": "gush"}, {"sleep_hours": 7.3}, {"sleep_hours": 24.5}, {"sleep_hours": -0.5},
        {"water_glasses": 31}, {"water_glasses": -1}, {"water_glasses": 2.5},
        {"note": "x" * 1001}, {"surprise": 1},
        {"medications_taken": ["not-a-uuid"]},
    ]
    for body in bad_bodies:
        assert _put(client, user, "2026-10-20", body).status_code == 422, body
    assert _put(client, user, "2026-10-20", {"note": "x" * 1000, "mood": 5, "sleep_hours": 24, "water_glasses": 30}).status_code == 200
    assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 1


def test_date_limits(client, make_user):
    user = make_user()
    today = date.today()
    assert _put(client, user, str(today), {"mood": 3}).status_code == 200
    assert _put(client, user, str(today + timedelta(days=1)), {"mood": 3}).status_code == 200  # time-zone tolerance
    assert _put(client, user, str(today + timedelta(days=2)), {"mood": 3}).status_code == 422
    assert _put(client, user, "1999-12-31", {"mood": 3}).status_code == 422
    assert _put(client, user, "2000-01-01", {"mood": 3}).status_code == 200
    assert _put(client, user, "2026-13-40", {"mood": 3}).status_code == 422
    assert _put(client, user, "not-a-date", {"mood": 3}).status_code == 422


def test_range_rules(client, make_user):
    user = make_user()
    h = _h(user)
    assert client.get(URL, headers=h).status_code == 422
    assert client.get(URL + "?from=2026-10-01", headers=h).status_code == 422
    assert client.get(URL + "?from=2026-10-10&to=2026-10-09", headers=h).status_code == 422
    assert client.get(URL + "?from=2026-10-10&to=2026-10-10", headers=h).status_code == 200
    start = date(2025, 1, 1)
    assert client.get(URL + f"?from={start}&to={start + timedelta(days=400)}", headers=h).status_code == 200
    assert client.get(URL + f"?from={start}&to={start + timedelta(days=401)}", headers=h).status_code == 422


def test_results_are_ordered_and_bounded_by_the_range(client, make_user):
    user = make_user()
    for day in ["2026-10-05", "2026-10-01", "2026-11-02"]:
        _put(client, user, day, {"mood": 3})
    rows = client.get(URL + "?from=2026-10-01&to=2026-10-31", headers=_h(user)).json()
    assert [r["date"] for r in rows] == ["2026-10-01", "2026-10-05"]


def test_users_are_isolated(client, db, make_user):
    a, b = make_user(email="a@gmail.com"), make_user(email="b@gmail.com")
    _put(client, a, "2026-10-20", {"mood": 5, "note": "mine"})
    assert client.get(URL + "?from=2026-10-01&to=2026-10-31", headers=_h(b)).json() == []
    _put(client, b, "2026-10-20", {"mood": 1})
    assert client.get(URL + "?from=2026-10-01&to=2026-10-31", headers=_h(a)).json()[0]["mood"] == 5
    assert client.delete(URL + "2026-10-20", headers=_h(b)).status_code == 200
    assert client.get(URL + "?from=2026-10-01&to=2026-10-31", headers=_h(a)).json()[0]["note"] == "mine"


def test_foreign_or_unknown_medication_ids_are_a_generic_422(client, db, make_user):
    a, b = make_user(email="a@gmail.com"), make_user(email="b@gmail.com")
    foreign = _med(db, b)
    unknown = "00000000-0000-0000-0000-000000000000"
    r1 = _put(client, a, "2026-10-20", {"medications_taken": [foreign]})
    r2 = _put(client, a, "2026-10-20", {"medications_taken": [unknown]})
    assert r1.status_code == r2.status_code == 422
    assert r1.json() == r2.json()  # same body: existence is not revealed
    assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 0


def test_archived_medications_can_still_be_referenced(client, db, make_user):
    user = make_user()
    med = Medication(user_id=user.id, name="Old", archived=True)
    db.add(med)
    db.commit()
    assert _put(client, user, "2026-10-20", {"medications_taken": [str(med.id)]}).status_code == 200


def test_delete_is_idempotent(client, make_user):
    user = make_user()
    _put(client, user, "2026-10-20", {"mood": 3})
    assert client.delete(URL + "2026-10-20", headers=_h(user)).status_code == 200
    assert client.delete(URL + "2026-10-20", headers=_h(user)).status_code == 200
    assert client.get(URL + "?from=2026-10-20&to=2026-10-20", headers=_h(user)).json() == []


def test_payload_is_encrypted_at_rest(client, db, make_user):
    user = make_user()
    _put(client, user, "2026-10-20", {"note": "VerySecretNote", "mood": 2, "symptoms": ["cramps"]})
    raw = db.execute(text("select data from daily_logs")).scalar_one()
    assert "VerySecretNote" not in raw and "cramps" not in raw


def test_deleted_medication_ids_in_old_logs_are_still_returned_unchanged(client, db, make_user):
    user = make_user()
    med_id = _med(db, user)
    _put(client, user, "2026-10-20", {"medications_taken": [med_id], "mood": 3})
    db.query(Medication).delete()
    db.commit()
    rows = client.get(URL + "?from=2026-10-20&to=2026-10-20", headers=_h(user)).json()
    assert rows[0]["medications_taken"] == [med_id]


def test_concurrent_first_save_recovers_to_a_single_row(client, db, make_user, monkeypatch):
    user = make_user()
    real_commit = Session.commit
    state = {"raced": False}

    def racing_commit(self):
        if not state["raced"] and any(isinstance(o, DailyLog) for o in self.new):
            state["raced"] = True
            self.rollback()
            self.add(DailyLog(user_id=user.id, log_date=date(2026, 10, 20), data={"mood": 1}))
            real_commit(self)  # the competing request wins the insert
            raise IntegrityError("insert", {}, Exception("unique"))
        return real_commit(self)

    monkeypatch.setattr(Session, "commit", racing_commit)
    response = _put(client, user, "2026-10-20", {"mood": 4})
    assert response.status_code == 200 and response.json()["mood"] == 4
    assert state["raced"] is True
    assert db.execute(text("select count(*) from daily_logs")).scalar_one() == 1
