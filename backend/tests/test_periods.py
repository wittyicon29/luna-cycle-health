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
