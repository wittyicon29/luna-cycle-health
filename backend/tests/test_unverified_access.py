from app.core.security import create_access_token


def _headers(user):
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user.id)})}"}


def test_unverified_user_token_is_rejected(client, make_user):
    user = make_user(email="unv@gmail.com", verified=False)

    response = client.get("/api/v1/auth/status", headers=_headers(user))

    assert response.status_code == 403
    assert response.json()["detail"] == "Please verify your email to continue."


def test_verified_user_token_still_works(client, make_user):
    user = make_user(email="ver@gmail.com", verified=True)

    assert client.get("/api/v1/auth/status", headers=_headers(user)).status_code == 200
