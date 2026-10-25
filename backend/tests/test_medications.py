from sqlalchemy import text

from app.core.security import create_access_token

URL = "/api/v1/medications/"


def _h(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def test_requires_authentication(client):
    response = client.get(URL)
    assert response.status_code == 403
    assert response.json()["detail"] == "Not authenticated"


def test_create_list_rename_archive_delete(client, make_user):
    user = make_user()
    created = client.post(URL, json={"name": "  Iron tablet "}, headers=_h(user))
    assert created.status_code == 201
    med = created.json()
    assert med["name"] == "Iron tablet" and med["archived"] is False

    assert [m["name"] for m in client.get(URL, headers=_h(user)).json()] == ["Iron tablet"]

    renamed = client.patch(f"{URL}{med['id']}", json={"name": "Iron 100mg"}, headers=_h(user))
    assert renamed.status_code == 200 and renamed.json()["name"] == "Iron 100mg"

    archived = client.patch(f"{URL}{med['id']}", json={"archived": True}, headers=_h(user))
    assert archived.status_code == 200 and archived.json()["archived"] is True
    assert client.get(URL, headers=_h(user)).json() == []
    assert len(client.get(URL + "?include_archived=true", headers=_h(user)).json()) == 1

    assert client.delete(f"{URL}{med['id']}", headers=_h(user)).status_code == 200
    assert client.get(URL + "?include_archived=true", headers=_h(user)).json() == []


def test_name_validation(client, make_user):
    user = make_user()
    for bad in ["", "   ", "x" * 61, None, 5]:
        assert client.post(URL, json={"name": bad}, headers=_h(user)).status_code == 422
    assert client.post(URL, json={"name": "x" * 60}, headers=_h(user)).status_code == 201


def test_duplicate_names_are_case_insensitive_among_active_items(client, make_user):
    user = make_user()
    first = client.post(URL, json={"name": "Vitamin D"}, headers=_h(user)).json()
    assert client.post(URL, json={"name": "vitamin d"}, headers=_h(user)).status_code == 409
    client.patch(f"{URL}{first['id']}", json={"archived": True}, headers=_h(user))
    assert client.post(URL, json={"name": "VITAMIN D"}, headers=_h(user)).status_code == 201


def test_active_item_limit_is_30(client, make_user):
    user = make_user()
    for i in range(30):
        assert client.post(URL, json={"name": f"item {i}"}, headers=_h(user)).status_code == 201
    assert client.post(URL, json={"name": "one too many"}, headers=_h(user)).status_code == 422


def test_users_are_isolated(client, make_user):
    a, b = make_user(email="a@gmail.com"), make_user(email="b@gmail.com")
    med = client.post(URL, json={"name": "Private"}, headers=_h(a)).json()
    assert client.get(URL, headers=_h(b)).json() == []
    assert client.patch(f"{URL}{med['id']}", json={"name": "x"}, headers=_h(b)).status_code == 404
    assert client.delete(f"{URL}{med['id']}", headers=_h(b)).status_code == 404
    assert client.get(URL, headers=_h(a)).json()[0]["name"] == "Private"


def test_patch_needs_a_field_and_unknown_id_is_404(client, make_user):
    user = make_user()
    med = client.post(URL, json={"name": "A"}, headers=_h(user)).json()
    assert client.patch(f"{URL}{med['id']}", json={}, headers=_h(user)).status_code == 422
    assert client.patch(f"{URL}00000000-0000-0000-0000-000000000000", json={"name": "B"}, headers=_h(user)).status_code == 404


def test_name_is_encrypted_at_rest(client, db, make_user):
    user = make_user()
    client.post(URL, json={"name": "SecretPillName"}, headers=_h(user))
    raw = db.execute(text("select name from medications")).scalar_one()
    assert "SecretPillName" not in raw


LOGS = "/api/v1/logs/"


def _med(client, user, name):
    return client.post(URL, json={"name": name}, headers=_h(user)).json()["id"]


def test_deleting_a_medication_removes_its_id_from_daily_logs(client, make_user):
    user = make_user()
    iron, vit = _med(client, user, "Iron"), _med(client, user, "Vitamin D")
    client.put(LOGS + "2026-10-01", json={"mood": 3, "note": "n", "medications_taken": [iron, vit]}, headers=_h(user))

    assert client.delete(f"{URL}{iron}", headers=_h(user)).status_code == 200

    rows = client.get(LOGS + "?from=2026-10-01&to=2026-10-01", headers=_h(user)).json()
    assert len(rows) == 1
    assert rows[0]["medications_taken"] == [vit]
    assert rows[0]["mood"] == 3 and rows[0]["note"] == "n"


def test_a_log_that_only_held_the_deleted_medication_is_removed(client, make_user):
    user = make_user()
    iron = _med(client, user, "Iron")
    client.put(LOGS + "2026-10-01", json={"medications_taken": [iron]}, headers=_h(user))
    client.put(LOGS + "2026-10-02", json={"sleep_hours": 0, "medications_taken": [iron]}, headers=_h(user))

    client.delete(f"{URL}{iron}", headers=_h(user))

    rows = client.get(LOGS + "?from=2026-10-01&to=2026-10-03", headers=_h(user)).json()
    assert [r["date"] for r in rows] == ["2026-10-02"]  # emptied day gone; the day with sleep 0 stays
    assert rows[0]["sleep_hours"] == 0 and rows[0]["medications_taken"] == []


def test_deleting_a_medication_leaves_other_users_logs_alone(client, make_user):
    a, b = make_user("a@gmail.com"), make_user("b@gmail.com")
    med_a = _med(client, a, "Iron")
    med_b = _med(client, b, "Iron")
    client.put(LOGS + "2026-10-01", json={"mood": 2, "medications_taken": [med_b]}, headers=_h(b))
    client.put(LOGS + "2026-10-01", json={"mood": 4, "medications_taken": [med_a]}, headers=_h(a))

    client.delete(f"{URL}{med_a}", headers=_h(a))

    row_b = client.get(LOGS + "?from=2026-10-01&to=2026-10-01", headers=_h(b)).json()[0]
    assert row_b["medications_taken"] == [med_b] and row_b["mood"] == 2


def test_check_in_after_deleting_a_medication_succeeds(client, make_user):
    user = make_user()
    iron = _med(client, user, "Iron")
    client.put(LOGS + "2026-10-01", json={"mood": 2, "note": "n", "medications_taken": [iron]}, headers=_h(user))
    client.delete(f"{URL}{iron}", headers=_h(user))

    entry = client.get(LOGS + "?from=2026-10-01&to=2026-10-01", headers=_h(user)).json()[0]
    body = {k: entry[k] for k in ("mood", "note", "medications_taken")}
    body["mood"] = 4
    assert client.put(LOGS + "2026-10-01", json=body, headers=_h(user)).status_code == 200


def test_deleting_an_unreferenced_or_archived_medication_still_works(client, make_user):
    user = make_user()
    iron, vit = _med(client, user, "Iron"), _med(client, user, "Vitamin D")
    client.put(LOGS + "2026-10-01", json={"medications_taken": [vit]}, headers=_h(user))
    client.patch(f"{URL}{vit}", json={"archived": True}, headers=_h(user))  # archiving keeps the id valid in logs

    assert client.delete(f"{URL}{iron}", headers=_h(user)).status_code == 200
    row = client.get(LOGS + "?from=2026-10-01&to=2026-10-01", headers=_h(user)).json()[0]
    assert row["medications_taken"] == [vit]
