from datetime import date

from app.core.security import create_access_token
from app.models.models import Period

URL = "/api/v1/periods/prediction"


def _add_periods(db, user, starts):
    for start in starts:
        db.add(Period(user_id=user.id, start_date=start))
    db.commit()


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def test_requires_authentication(client):
    # HTTPBearer on FastAPI 0.115 answers a missing Authorization header with 403.
    response = client.get(URL)

    assert response.status_code == 403
    assert response.json()["detail"] == "Not authenticated"


def test_no_periods_returns_all_null(client, make_user):
    user = make_user()

    response = client.get(URL, headers=_headers(user))

    assert response.status_code == 200
    assert response.json() == {"predicted_next_period": None, "earliest": None, "latest": None}


def test_a_single_period_is_not_enough_data(client, db, make_user):
    user = make_user()
    _add_periods(db, user, [date(2026, 9, 1)])

    response = client.get(URL, headers=_headers(user))

    assert response.status_code == 200
    assert response.json()["predicted_next_period"] is None


def test_regular_cycles_predict_the_next_start(client, db, make_user):
    user = make_user()
    _add_periods(db, user, [date(2026, 6, 1), date(2026, 6, 29), date(2026, 7, 27), date(2026, 8, 24)])

    response = client.get(URL, headers=_headers(user))

    body = response.json()
    assert response.status_code == 200
    assert body["predicted_next_period"] == "2026-09-21"  # 2026-08-24 + 28 days
    assert body["earliest"] <= body["predicted_next_period"] <= body["latest"]


def test_response_has_no_fertility_fields(client, db, make_user):
    user = make_user()
    _add_periods(db, user, [date(2026, 6, 1), date(2026, 6, 29), date(2026, 7, 27)])

    body = client.get(URL, headers=_headers(user)).json()

    assert set(body) == {"predicted_next_period", "earliest", "latest"}


def test_only_the_callers_periods_are_used(client, db, make_user):
    me = make_user(email="me@gmail.com")
    other = make_user(email="other@gmail.com")
    _add_periods(db, other, [date(2026, 6, 1), date(2026, 6, 29), date(2026, 7, 27)])

    body = client.get(URL, headers=_headers(me)).json()

    assert body["predicted_next_period"] is None


def test_route_is_not_shadowed_by_the_period_id_route(client, make_user):
    user = make_user()
    assert client.get(URL, headers=_headers(user)).status_code != 422
