def test_authenticated_request_works(client, auth_headers):
    response = client.get("/api/v1/auth/status", headers=auth_headers)

    assert response.status_code == 200
    assert response.json()["email"] == "user@gmail.com"


def test_each_test_starts_with_an_empty_database(db):
    from app.models.models import User

    assert db.query(User).count() == 0
