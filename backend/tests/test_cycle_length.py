from app.core.security import create_access_token


def headers_for(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def create(client, headers, start):
    response = client.post("/api/v1/periods/", json={"start_date": start}, headers=headers)
    assert response.status_code == 200
    return response.json()


def lengths(client, headers):
    rows = client.get("/api/v1/periods/", headers=headers).json()
    return {row["start_date"]: row["cycle_length"] for row in rows}


def test_cycle_length_is_the_gap_to_the_previous_period(client, make_user):
    headers = headers_for(make_user())

    create(client, headers, "2026-07-01")
    create(client, headers, "2026-07-29")
    create(client, headers, "2026-08-28")

    assert lengths(client, headers) == {"2026-07-01": None, "2026-07-29": 28, "2026-08-28": 30}


def test_logging_an_earlier_period_later_fixes_the_following_gap(client, make_user):
    headers = headers_for(make_user())
    create(client, headers, "2026-07-01")
    create(client, headers, "2026-08-28")

    create(client, headers, "2026-07-29")

    assert lengths(client, headers) == {"2026-07-01": None, "2026-07-29": 28, "2026-08-28": 30}


def test_deleting_a_period_rejoins_its_neighbours(client, make_user):
    headers = headers_for(make_user())
    create(client, headers, "2026-07-01")
    middle = create(client, headers, "2026-07-29")
    create(client, headers, "2026-08-28")

    client.delete(f"/api/v1/periods/{middle['id']}", headers=headers)

    assert lengths(client, headers) == {"2026-07-01": None, "2026-08-28": 58}


def test_editing_a_start_date_recomputes(client, make_user):
    headers = headers_for(make_user())
    create(client, headers, "2026-07-01")
    second = create(client, headers, "2026-07-29")

    client.put(f"/api/v1/periods/{second['id']}", json={"start_date": "2026-07-31"}, headers=headers)

    assert lengths(client, headers)["2026-07-31"] == 30


def test_one_users_periods_never_affect_anothers(client, make_user):
    a = headers_for(make_user("a@gmail.com"))
    b = headers_for(make_user("b@gmail.com"))
    create(client, a, "2026-07-01")
    create(client, b, "2026-07-15")

    create(client, a, "2026-07-29")

    assert lengths(client, b) == {"2026-07-15": None}


def test_create_and_update_responses_include_recomputed_cycle_length(client, make_user):
    headers = headers_for(make_user())

    create(client, headers, "2026-07-01")
    second = create(client, headers, "2026-07-29")
    assert second["cycle_length"] == 28

    response = client.put(
        f"/api/v1/periods/{second['id']}", json={"start_date": "2026-08-01"}, headers=headers
    )
    assert response.status_code == 200
    assert response.json()["cycle_length"] == 31


def test_period_writes_commit_once(client, make_user, monkeypatch):
    from sqlalchemy.orm import Session

    headers = headers_for(make_user())
    first = create(client, headers, "2026-07-01")
    second = create(client, headers, "2026-07-29")
    commits = []
    real_commit = Session.commit
    monkeypatch.setattr(Session, "commit", lambda self: (commits.append(1), real_commit(self))[1])

    create(client, headers, "2026-08-28")
    assert len(commits) == 1

    commits.clear()
    client.put(f"/api/v1/periods/{second['id']}", json={"start_date": "2026-07-30"}, headers=headers)
    assert len(commits) == 1

    commits.clear()
    client.delete(f"/api/v1/periods/{first['id']}", headers=headers)
    assert len(commits) == 1
