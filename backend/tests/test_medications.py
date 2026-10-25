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
