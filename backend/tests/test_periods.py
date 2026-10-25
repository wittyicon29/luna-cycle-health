from datetime import date, timedelta

from app.core.security import create_access_token
from app.models.models import Period


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def create(client, headers, **overrides):
    body = {"start_date": "2026-01-01", "flow_intensity": "medium", "pain_level": 3,
            "symptoms": ["cramps"], "notes": "ok"}
    body.update(overrides)
    return client.post("/api/v1/periods/", json=body, headers=headers)


def test_create_period(client, auth_headers):
    response = create(client, auth_headers)

    assert response.status_code == 200
    assert response.json()["notes"] == "ok"


def test_end_before_start_is_rejected(client, auth_headers):
    assert create(client, auth_headers, end_date="2025-12-31").status_code == 422


def test_invalid_flow_is_rejected_not_a_500(client, auth_headers):
    assert create(client, auth_headers, flow_intensity="torrential").status_code == 422


def test_far_future_start_is_rejected_but_tomorrow_is_allowed(client, auth_headers):
    far = (date.today() + timedelta(days=30)).isoformat()
    tomorrow = (date.today() + timedelta(days=1)).isoformat()

    assert create(client, auth_headers, start_date=far).status_code == 422
    assert create(client, auth_headers, start_date=tomorrow).status_code == 200


def test_oversized_text_is_rejected(client, auth_headers):
    assert create(client, auth_headers, notes="x" * 2001).status_code == 422
    assert create(client, auth_headers, symptoms=["s"] * 31).status_code == 422
    assert create(client, auth_headers, symptoms=["x" * 51]).status_code == 422


def test_invalid_period_id_is_422(client, auth_headers):
    assert client.get("/api/v1/periods/not-a-uuid", headers=auth_headers).status_code == 422


def test_delete_period(client, auth_headers, db):
    period_id = create(client, auth_headers).json()["id"]

    response = client.delete(f"/api/v1/periods/{period_id}", headers=auth_headers)

    assert response.status_code == 200
    assert db.query(Period).count() == 0
    assert client.delete(f"/api/v1/periods/{period_id}", headers=auth_headers).status_code == 404


def test_cannot_delete_or_edit_another_users_period(client, db, make_user):
    owner, intruder = make_user("a@gmail.com"), make_user("b@gmail.com")
    period_id = create(client, headers_for(owner)).json()["id"]

    delete = client.delete(f"/api/v1/periods/{period_id}", headers=headers_for(intruder))
    edit = client.put(f"/api/v1/periods/{period_id}", json={"start_date": "2026-02-02"},
                      headers=headers_for(intruder))

    assert delete.status_code == 404
    assert edit.status_code == 404
    assert db.query(Period).count() == 1


import uuid

_h = headers_for


def test_create_with_client_id_is_idempotent(client, make_user):
    user = make_user()
    pid = str(uuid.uuid4())
    body = {"id": pid, "start_date": "2026-10-01", "end_date": "2026-10-05"}
    first = client.post("/api/v1/periods/", json=body, headers=_h(user))
    second = client.post("/api/v1/periods/", json=body, headers=_h(user))
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == pid == second.json()["id"]
    assert len(client.get("/api/v1/periods/", headers=_h(user)).json()) == 1


def test_replay_with_different_body_returns_stored_period(client, make_user):
    user = make_user()
    pid = str(uuid.uuid4())
    client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-10-01", "pain_level": 3}, headers=_h(user))
    again = client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-10-02", "pain_level": 9}, headers=_h(user))
    assert again.status_code == 200
    assert again.json()["start_date"] == "2026-10-01" and again.json()["pain_level"] == 3


def test_foreign_id_is_409_and_leaks_nothing(client, make_user):
    a, b = make_user("a@gmail.com"), make_user("b@gmail.com")
    pid = str(uuid.uuid4())
    client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-10-01", "pain_level": 4}, headers=_h(a))
    clash = client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-09-01"}, headers=_h(b))
    assert clash.status_code == 409
    assert "2026-10-01" not in clash.text and "pain" not in clash.text
    assert client.get("/api/v1/periods/", headers=_h(b)).json() == []
    assert client.get("/api/v1/periods/", headers=_h(a)).json()[0]["pain_level"] == 4


def test_malformed_id_is_422_and_null_id_is_ignored(client, make_user):
    user = make_user()
    assert client.post("/api/v1/periods/", json={"id": "nope", "start_date": "2026-10-01"}, headers=_h(user)).status_code == 422
    ok = client.post("/api/v1/periods/", json={"id": None, "start_date": "2026-10-01"}, headers=_h(user))
    assert ok.status_code == 200 and ok.json()["id"]


def test_put_ignores_id_in_body(client, make_user):
    user = make_user()
    created = client.post("/api/v1/periods/", json={"start_date": "2026-10-01"}, headers=_h(user)).json()
    other = str(uuid.uuid4())
    updated = client.put(f"/api/v1/periods/{created['id']}", json={"id": other, "start_date": "2026-10-02"}, headers=_h(user))
    assert updated.status_code == 200 and updated.json()["id"] == created["id"]


def test_concurrent_first_post_with_same_id_does_not_500(client, make_user, db, monkeypatch):
    # simulate the loser of a race: the pre-check sees nothing, the INSERT hits the primary key
    user = make_user()
    pid = str(uuid.uuid4())
    client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-10-01"}, headers=_h(user))
    from app.api import periods as periods_api
    real = periods_api._find_by_id
    calls = {"n": 0}

    def blind_once(db_, pid_):
        calls["n"] += 1
        return None if calls["n"] == 1 else real(db_, pid_)

    monkeypatch.setattr(periods_api, "_find_by_id", blind_once)
    again = client.post("/api/v1/periods/", json={"id": pid, "start_date": "2026-10-01"}, headers=_h(user))
    assert again.status_code == 200 and again.json()["id"] == pid
